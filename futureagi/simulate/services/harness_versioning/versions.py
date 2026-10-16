"""Record environment and suite versions from an authoring archive and move the defaults."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from django.conf import settings
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from simulate.models import (
    HarnessEnvironmentVersion,
    HarnessSuiteMember,
    HarnessSuiteValidation,
    HarnessSuiteVersion,
    HostedHarnessJob,
    HostedHarnessScenario,
)
from simulate.models.harness_versioning import ArchiveLayout, HashKind, VersionStatus
from simulate.models.hosted_harness import MAX_SCENARIOS_PER_JOB
from simulate.services.harness_versioning import archives, diffs, hashing
from simulate.services.hosted_harness import HostedHarnessError

logger = logging.getLogger(__name__)

CODE_SOURCE_KINDS = frozenset({"github", "archive", "remote"})
# Only a build proves its suite against its environment; edits carry older proofs.
PROVED_ORIGINS = frozenset({"authoring", "extend"})
# Saves where a person introduces scenarios; a dropped scenario's key is never reused.
USER_ORIGINS = frozenset({"chat", "manual"})
# The sandbox writes proof times on its own clock.
PROOF_CLOCK_SKEW = timedelta(minutes=2)
SCENARIO_COUNT_MAX = 32767
REMOVED_REASONS = {
    "manual": "removed by manual edit",
    "chat": "removed in chat",
    "extend": "removed when scenarios were added",
    "authoring": "removed when the environment was rebuilt",
    "nudge": "removed when the environment was updated",
}
SUITE_OUTPUT_KINDS = frozenset({"scenarios", "coverage"})
SEALED_MANIFEST = "environment-bundle/manifest.json"
MEMBER_FIELDS = (
    "name",
    "instruction",
    "use_case",
    "branch",
    "tests",
    "folder",
    "persona",
    "coverage",
    "sub_goals",
    "keywords",
    "background_noise",
    "max_turns",
)


@dataclass(frozen=True)
class RecordedVersions:
    environment: HarnessEnvironmentVersion
    suite: HarnessSuiteVersion
    pair_key: str


@dataclass(frozen=True)
class Pieces:
    """An authoring tree split into its environment and suite archives, hashed."""

    environment_body: bytes
    suite_body: bytes
    environment_key: str
    suite_key: str
    environment_hash: str
    suite_hash: str
    contract: dict[str, Any]
    scenarios: list[dict[str, Any]]
    environment_documents: dict[str, Any]
    suite_documents: dict[str, Any]
    environment_fields: dict[str, Any]
    suite_fields: dict[str, Any]


def versioning_enabled() -> bool:
    return bool(getattr(settings, "HARNESS_VERSIONING_ENABLED", False))


def environment_head(job: HostedHarnessJob) -> HostedHarnessJob | None:
    """The environment a job belongs to, read fresh; ``None`` once it is deleted."""
    return (
        HostedHarnessJob.no_workspace_objects.filter(id=job.environment_id or job.id)
        .only("id", "environment_version_id")
        .first()
    )


def is_versioned(job: HostedHarnessJob) -> bool:
    """Whether this environment's archive writes go through versions, read fresh.

    An environment that has versions keeps them current whether or not the flag is on;
    the flag only decides whether an environment without versions starts getting them.
    """
    head = environment_head(job)
    return head is not None and head.environment_version_id is not None


def pins_runs(environment: HostedHarnessJob) -> bool:
    """Whether a new run of this environment is pinned to its default versions.

    Recording, exact key pairing and refusing a dropped or taken key apply whenever an
    environment has versions, flag or not; only pinning a run waits for the flag.
    """
    return (
        versioning_enabled()
        and environment.environment_version_id is not None
        and environment.suite_version_id is not None
    )


def _json(files: Mapping[str, bytes], path: str) -> Any:
    body = files.get(path)
    if not body:
        return None
    try:
        return json.loads(body)
    except ValueError:
        return None


def _provider_agent(payload: Mapping[str, Any]) -> bool:
    """A hosted or phone agent's prompt belongs to the agent, not the environment."""
    source = payload.get("source") or {}
    return str(source.get("kind") or "") not in CODE_SOURCE_KINDS


def _sub_goals(files: Mapping[str, bytes]) -> list[dict[str, Any]]:
    value = _json(files, "sub_goals.json")
    if isinstance(value, dict):
        value = value.get("sub_goals")
    return [goal for goal in value or [] if isinstance(goal, dict) and goal.get("name")]


def suite_documents(suite: Mapping[str, bytes]) -> list[dict[str, Any]]:
    """The suite's scenarios, from its index or else from each folder's document."""
    listed = _json(suite, "scenarios.json")
    if isinstance(listed, list):
        return [one for one in listed if isinstance(one, dict)]
    found: list[dict[str, Any]] = []
    for path in sorted(suite):
        parts = path.split("/")
        if len(parts) == 3 and parts[2] == "scenario.json":
            document = _json(suite, path)
            if isinstance(document, dict):
                found.append({"scenario_key": parts[1], **document})
    return found


def _file_digests(environment: Mapping[str, bytes]) -> dict[str, str]:
    return {
        path: archives.sha256_hex(data)
        for path, data in environment.items()
        if not hashing.is_environment_unhashed(path)
    }


def _stage_outputs(pair_body: bytes) -> list[dict[str, Any]]:
    from simulate.services.hosted_harness_gateway import (
        authoring_stage_outputs_from_archive,
    )

    return authoring_stage_outputs_from_archive(pair_body)


def prepare_pieces(
    job: HostedHarnessJob,
    split: archives.SplitArchive,
    *,
    outputs: list[dict[str, Any]],
    authoring_revision: str,
) -> Pieces:
    """Pack, key and hash both pieces and their readable documents; stores nothing."""
    payload = job.payload or {}
    connector = str((payload.get("agent") or {}).get("connector") or "")
    environment_body = archives.pack_archive(split.environment)
    suite_body = archives.pack_archive(split.suite)
    environment_key = archives.environment_key(
        job.organization_id, job.id, environment_body
    )
    suite_key = archives.suite_key(job.organization_id, job.id, suite_body)
    contract = _json(split.environment, "contract.json") or {}
    sub_goals = _sub_goals(split.environment)
    scenarios = suite_documents(split.suite)
    environment_documents = {
        "contract": contract,
        "sub_goals": sub_goals,
        "sub_goal_digests": hashing.sub_goal_digests(sub_goals),
        "file_digests": _file_digests(split.environment),
        "stage_outputs": [
            one for one in outputs if one.get("kind") not in SUITE_OUTPUT_KINDS
        ],
        "authoring_revisions": [authoring_revision],
    }
    suite_documents_ = {
        "scenarios": scenarios,
        "coverage": _json(split.suite, "coverage.json"),
        "stage_outputs": [
            one for one in outputs if one.get("kind") in SUITE_OUTPUT_KINDS
        ],
        "authoring_revisions": [authoring_revision],
    }
    return Pieces(
        environment_body=environment_body,
        suite_body=suite_body,
        environment_key=environment_key,
        suite_key=suite_key,
        environment_hash=hashing.environment_hash(
            split.environment, provider_agent=_provider_agent(payload)
        ),
        suite_hash=hashing.suite_hash(split.suite),
        contract=contract,
        scenarios=scenarios,
        environment_documents=environment_documents,
        suite_documents=suite_documents_,
        environment_fields={
            "archive_object_key": environment_key,
            "archive_layout": ArchiveLayout.SPLIT,
            "archive_sha256": archives.sha256_hex(environment_body),
            "archive_size": len(environment_body),
            "documents": environment_documents,
            "contract_hash_raw": hashing.contract_hash_raw(split.environment),
            "world_ir_hash": hashing.world_ir_hash(split.environment),
        },
        suite_fields={
            "archive_object_key": suite_key,
            "archive_layout": ArchiveLayout.SPLIT,
            "archive_sha256": archives.sha256_hex(suite_body),
            "archive_size": len(suite_body),
            "documents": suite_documents_,
            "certify_hash": hashing.suite_certify_hash(
                split.suite, keep_overlay=connector == "retell_chat"
            ),
        },
    )


def _sealed(
    split: archives.SplitArchive, metadata: Mapping[str, Any]
) -> dict[str, bytes]:
    """The archive's own sealed bundle, or the copy kept from an earlier one.

    Runs replay ``environment-bundle/`` from the pair, so a pair without it cannot run.
    """
    if SEALED_MANIFEST in split.sealed:
        return dict(split.sealed)
    key = str(metadata.get("sealed_bundle_object_key") or "")
    previous = archives.read_archive(archives.get_archive(key)) if key else {}
    return {**previous, **split.sealed}


def _next_number(model: Any, job: HostedHarnessJob) -> int:
    # The base manager: no workspace or soft-delete filter may hide a used number.
    highest = model._base_manager.filter(job=job).aggregate(top=Max("version_number"))
    return int(highest["top"] or 0) + 1


def _land(
    model: Any,
    job: HostedHarnessJob,
    *,
    hash: str,
    values: dict[str, Any],
    hash_kind: str = HashKind.TREE_V1,
) -> tuple[Any, bool]:
    """An active version with this hash: the existing one, or a new one numbered next."""
    existing = (
        # The base manager, so historical models in a migration work too.
        model._base_manager.filter(
            deleted=False,
            job=job,
            hash=hash,
            hash_kind=hash_kind,
            status=VersionStatus.ACTIVE,
        )
        .order_by("-version_number")
        .first()
    )
    if existing is not None:
        return existing, False
    created = model._base_manager.create(
        job=job,
        organization_id=job.organization_id,
        workspace_id=job.workspace_id,
        status=VersionStatus.ACTIVE,
        version_number=_next_number(model, job),
        hash=hash,
        hash_kind=hash_kind,
        **values,
    )
    return created, True


def recorded_revisions(version: Any) -> list[str]:
    """The authoring revisions a version was recorded from."""
    return [
        str(one)
        for one in (version.documents or {}).get("authoring_revisions") or []
        if one
    ]


def note_revision(version: Any, revision: str) -> None:
    """Remember that a reused version also stands for this authoring revision."""
    if not revision or revision in recorded_revisions(version):
        return
    documents = dict(version.documents or {})
    documents["authoring_revisions"] = [*recorded_revisions(version), revision]
    version.documents = documents
    version.save(update_fields=["documents", "updated_at"])


def _refuse_retired_keys(
    job: HostedHarnessJob, documents: list[dict[str, Any]]
) -> None:
    """A scenario a person adds may not take the key of one that was dropped.

    Only keys new to the environment's default suite are checked, compared as
    normalised tokens, so a scenario the default already holds is never refused.
    """
    from simulate.services.hosted_harness_gateway import _scenario_token

    keys = {
        _scenario_token(doc.get("scenario_key"))
        for doc in documents
        if str(doc.get("scenario_key") or "").strip()
    } - {""}
    if job.suite_version_id is not None:
        keys -= {
            _scenario_token(key)
            for key in HarnessSuiteMember.no_workspace_objects.filter(
                suite_version_id=job.suite_version_id
            ).values_list("scenario_key", flat=True)
        }
        # A member paired by name carries its row's key; its document keeps its own.
        documents_ = (
            HarnessSuiteVersion._base_manager.filter(id=job.suite_version_id)
            .values_list("documents", flat=True)
            .first()
        )
        scenarios = (
            documents_.get("scenarios") if isinstance(documents_, dict) else None
        )
        keys -= {
            _scenario_token(doc.get("scenario_key"))
            for doc in scenarios or []
            if isinstance(doc, dict)
        }
    if not keys:
        return
    retired = sorted(
        key
        for key in HostedHarnessScenario._base_manager.filter(
            job=job, deleted=True
        ).values_list("scenario_key", flat=True)
        if _scenario_token(key) in keys
    )
    if retired:
        raise HostedHarnessError(
            "scenario_key_retired",
            ", ".join(retired)
            + (" was" if len(retired) == 1 else " were")
            + " removed earlier and can't be reused; give the scenario a new name",
            status_code=422,
        )


def _refuse_taken_keys(job: HostedHarnessJob, documents: list[dict[str, Any]]) -> None:
    """A scenario a person adds may not take the key of a row another scenario holds.

    A backfill may have paired a scenario with a row keyed differently; that row stays
    with its scenario, so its key is not free for a new one.
    """
    from simulate.services.harness_scenarios import _default_member_rows
    from simulate.services.hosted_harness_gateway import _scenario_token

    if job.suite_version_id is None:
        return
    paired = _default_member_rows(
        job, list(HostedHarnessScenario.all_objects.filter(job=job))
    )
    held = {
        token: row.scenario_key
        for key_token, row in paired.items()
        if (token := _scenario_token(row.scenario_key)) != key_token
    }
    taken = sorted(
        {
            held[token]
            for doc in documents
            if (token := _scenario_token(doc.get("scenario_key"))) in held
            and token not in paired
        }
    )
    if taken:
        raise HostedHarnessError(
            "scenario_key_taken",
            ", ".join(taken)
            + (" is" if len(taken) == 1 else " are")
            + " already used by another scenario; give the scenario a new name",
            status_code=422,
        )


def _member_rows(
    job: HostedHarnessJob, documents: list[dict[str, Any]]
) -> list[tuple[HostedHarnessScenario, dict[str, Any]]]:
    from simulate.services.harness_scenarios import pair_scenarios

    # The rows indexing wrote each document to, so members never pair differently.
    return pair_scenarios(job, documents, prune=True, exact=True)


def _proved_at(proof: Mapping[str, Any]) -> datetime | None:
    """When a proof was made; a time without a zone is the sandbox's UTC."""
    try:
        value = datetime.fromisoformat(str(proof.get("proved_at") or ""))
    except ValueError:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _member_content(document: Mapping[str, Any]) -> dict[str, Any]:
    return {field: document[field] for field in MEMBER_FIELDS if field in document}


def _carried_proofs(
    environment_version: HarnessEnvironmentVersion,
    paired: list[tuple[HostedHarnessScenario, dict[str, Any]]],
) -> dict[str, Any]:
    """Earlier proofs against this environment version for scenarios that did not change.

    An extend proves only its new scenarios; the others keep the proofs they already have.
    """
    previous = (
        HarnessSuiteValidation.no_workspace_objects.filter(
            environment_version=environment_version
        )
        .order_by("-proved_at")
        .first()
    )
    if previous is None or not isinstance(previous.proofs, dict):
        return {}
    contents = {
        member.scenario_key: member.content
        for member in HarnessSuiteMember.no_workspace_objects.filter(
            suite_version_id=previous.suite_version_id
        )
    }
    carried: dict[str, Any] = {}
    for row, document in paired:
        proof = previous.proofs.get(row.scenario_key)
        if (
            isinstance(proof, dict)
            and row.scenario_key in contents
            and contents[row.scenario_key] == _member_content(document)
        ):
            carried[row.scenario_key] = proof
    return carried


def _validation(
    suite_version: HarnessSuiteVersion,
    environment_version: HarnessEnvironmentVersion,
    proofs: object,
    paired: list[tuple[HostedHarnessScenario, dict[str, Any]]],
    job: HostedHarnessJob,
    proved_since: datetime,
) -> None:
    """Record the build's proofs of this suite against this environment.

    Only proofs made in this session count: the proofs file travels with the suite, so
    older entries were made against other content. A proof without a time is ignored.
    Unchanged scenarios keep their earlier proofs against the same environment version.
    """
    # TODO: require each proof's environment_hash once ALK writes it.
    if not isinstance(proofs, dict) or not paired:
        return
    from simulate.services.hosted_harness_gateway import _scenario_token

    cutoff = proved_since - PROOF_CLOCK_SKEW
    by_token = {
        _scenario_token(key): value
        for key, value in proofs.items()
        if isinstance(value, dict)
        and (proved := _proved_at(value)) is not None
        and proved >= cutoff
    }
    if proofs and not by_token:
        logger.warning(
            "every proof predates this session job=%s proofs=%s since=%s",
            job.id,
            len(proofs),
            proved_since.isoformat(),
        )
    kept: dict[str, Any] = _carried_proofs(environment_version, paired)
    for row, document in paired:
        proof = by_token.get(_scenario_token(row.scenario_key)) or by_token.get(
            _scenario_token(document.get("scenario_key"))
        )
        if proof is not None:
            kept[row.scenario_key] = proof
    if not kept:
        return
    keys = [row.scenario_key for row, _ in paired]
    holding = [key for key in keys if kept.get(key, {}).get("holds") is True]
    if len(holding) == len(keys):
        status = HarnessSuiteValidation.Status.PASSED
    elif holding:
        status = HarnessSuiteValidation.Status.PARTIAL
    else:
        status = HarnessSuiteValidation.Status.FAILED
    HarnessSuiteValidation.no_workspace_objects.update_or_create(
        suite_version=suite_version,
        environment_version=environment_version,
        defaults={
            "status": status,
            "proofs": kept,
            "job": job,
            "proved_at": timezone.now(),
        },
    )


def record_authoring(
    job: HostedHarnessJob,
    body: bytes,
    *,
    origin: str,
    user: Any = None,
    expected_pair_key: str | None = None,
    proved_since: datetime | None = None,
    prepare_payload: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    consumes_extend_marker: bool = False,
) -> RecordedVersions | None:
    """Version an environment head's authoring archive and make it the default pair.

    Unchanged pieces reuse their active version. Run jobs, and environments without
    versions while versioning is off, are left to the legacy single archive. An environment
    that already has versions is always recorded; whether it has them is read fresh, since
    a backfill can land while a caller holds an old copy of the job.
    ``expected_pair_key`` is the pair an edit was made against; a newer default refuses
    the edit instead of losing it. ``proved_since`` is when this build's session started;
    without it no proof is recorded. ``prepare_payload`` applies the caller's own payload
    changes in the same save that moves the archive pointer. With
    ``consumes_extend_marker`` nothing is recorded once the job's extend marker is gone:
    an overlapping poll already recorded this extend.
    """
    if job.environment_id is not None:
        return None
    if not versioning_enabled() and not is_versioned(job):
        return None
    from simulate.services.hosted_harness_gateway import authoring_content_digest

    split = archives.split_authoring(archives.read_archive(body))
    if "contract.json" not in split.environment or not any(
        path.startswith(archives.SUITE_ROOTS) for path in split.suite
    ):
        raise HostedHarnessError(
            "authoring_incomplete",
            "the authoring archive has no contract or no scenarios to version",
            status_code=422,
        )
    payload = dict(job.payload or {})
    metadata = dict(payload.get("metadata") or {})
    sealed = _sealed(split, metadata)

    pair_body = archives.pack_archive(
        archives.compose(split.environment, split.suite, sealed)
    )
    pair_key = archives.pair_key(job.organization_id, job.id, pair_body)
    revision = authoring_content_digest(pair_body)
    pieces = prepare_pieces(
        job, split, outputs=_stage_outputs(pair_body), authoring_revision=revision
    )
    if origin in USER_ORIGINS:
        # Refused before anything is uploaded; checked again under the lock below.
        _refuse_retired_keys(job, pieces.scenarios)
        _refuse_taken_keys(job, pieces.scenarios)
    archives.put_archive(pieces.environment_key, pieces.environment_body)
    archives.put_archive(pieces.suite_key, pieces.suite_body)
    archives.put_archive(pair_key, pair_body)
    sealed_key = ""
    if sealed:
        sealed_body = archives.pack_archive(sealed)
        sealed_key = archives.sealed_key(job.organization_id, job.id, sealed_body)
        archives.put_archive(sealed_key, sealed_body)
    contract = pieces.contract
    documents = pieces.scenarios

    with transaction.atomic():
        locked = HostedHarnessJob.no_workspace_objects.select_for_update().get(
            id=job.id
        )
        if not versioning_enabled() and locked.environment_version_id is None:
            return None
        if consumes_extend_marker and not (
            ((locked.payload or {}).get("metadata") or {}).get("scenario_extend")
        ):
            return None
        current_pair = ((locked.payload or {}).get("metadata") or {}).get(
            "authoring_object_key"
        )
        if expected_pair_key is not None and current_pair != expected_pair_key:
            raise HostedHarnessError(
                "version_conflict",
                "the environment changed while this edit was being saved",
                status_code=409,
            )
        if origin in USER_ORIGINS:
            _refuse_retired_keys(locked, documents)
            _refuse_taken_keys(locked, documents)
        base_environment = locked.environment_version
        base_suite = locked.suite_version
        environment_diff = None
        if base_environment is not None:
            previous = base_environment.documents or {}
            environment_diff = diffs.environment_diff(
                previous_contract=previous.get("contract"),
                contract=contract,
                previous_sub_goals=previous.get("sub_goal_digests") or {},
                sub_goals=pieces.environment_documents["sub_goal_digests"],
                previous_files=previous.get("file_digests"),
                files=pieces.environment_documents["file_digests"],
            )
        environment_version, environment_created = _land(
            HarnessEnvironmentVersion,
            locked,
            hash=pieces.environment_hash,
            values={
                **pieces.environment_fields,
                "origin": origin,
                "parent": base_environment,
                "summary": diffs.summarize_environment(environment_diff),
                "diff": environment_diff,
                # TODO: the build's own agent version once environment creation pins it.
                "agent_version_id": locked.agent_version_id,
                "created_by": user,
            },
        )
        suite_diff = None
        if base_suite is not None:
            suite_diff = diffs.suite_diff(
                (base_suite.documents or {}).get("scenarios") or [],
                documents,
                removed_reason=REMOVED_REASONS.get(origin, "removed"),
            )
        suite_version, suite_created = _land(
            HarnessSuiteVersion,
            locked,
            hash=pieces.suite_hash,
            values={
                **pieces.suite_fields,
                "origin": origin,
                "parent": base_suite,
                "summary": diffs.summarize_suite(suite_diff),
                "diff": suite_diff,
                "scenario_count": min(len(documents), SCENARIO_COUNT_MAX),
                "authored_against": environment_version,
                "created_by": user,
            },
        )
        if not environment_created:
            note_revision(environment_version, revision)
        if not suite_created:
            note_revision(suite_version, revision)
        paired = _member_rows(locked, documents)
        if suite_created:
            HarnessSuiteMember.no_workspace_objects.bulk_create(
                [
                    HarnessSuiteMember(
                        suite_version=suite_version,
                        scenario=row,
                        scenario_key=row.scenario_key,
                        number=row.number,
                        content=_member_content(document),
                    )
                    for row, document in paired
                ]
            )
        if origin in PROVED_ORIGINS and proved_since is not None:
            _validation(
                suite_version,
                environment_version,
                _json(split.suite, "proofs.json"),
                paired,
                locked,
                proved_since,
            )

        payload = dict(locked.payload or {})
        metadata = dict(payload.get("metadata") or {})
        metadata["authoring_object_key"] = pair_key
        # TODO: chat compares this content digest; it can become the version pair at step 13.
        metadata["authoring_revision"] = revision
        if sealed_key:
            metadata["sealed_bundle_object_key"] = sealed_key
        payload["metadata"] = metadata
        if prepare_payload is not None:
            payload = prepare_payload(payload)
        update_fields = [
            "payload",
            "environment_version",
            "suite_version",
            "content_updated_at",
            "updated_at",
        ]
        if 1 <= suite_version.scenario_count <= MAX_SCENARIOS_PER_JOB:
            payload["scenario_count"] = suite_version.scenario_count
            locked.scenario_count = suite_version.scenario_count
            update_fields.append("scenario_count")
        locked.payload = payload
        locked.environment_version = environment_version
        locked.suite_version = suite_version
        locked.content_updated_at = timezone.now()
        locked.save(update_fields=update_fields)

    job.refresh_from_db()
    return RecordedVersions(
        environment=environment_version, suite=suite_version, pair_key=pair_key
    )


def record_authoring_quietly(
    job: HostedHarnessJob,
    body: bytes,
    *,
    origin: str,
    user: Any = None,
    proved_since: datetime | None = None,
) -> RecordedVersions | None:
    """``record_authoring`` for an environment's first versions; never fails the legacy
    save. Saves to an environment that already has versions call ``record_authoring``.
    """
    try:
        return record_authoring(
            job, body, origin=origin, user=user, proved_since=proved_since
        )
    except Exception:  # noqa: BLE001 - the legacy archive stays authoritative
        logger.exception("could not record versions job=%s origin=%s", job.id, origin)
        return None
