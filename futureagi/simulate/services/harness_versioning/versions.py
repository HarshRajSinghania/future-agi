"""Record environment and suite versions from an authoring archive and move the defaults."""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass
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
from simulate.models.harness_versioning import HashKind, VersionStatus
from simulate.models.hosted_harness import MAX_SCENARIOS_PER_JOB
from simulate.services.harness_versioning import archives, diffs, hashing
from simulate.services.hosted_harness import HostedHarnessError

logger = logging.getLogger(__name__)

CODE_SOURCE_KINDS = frozenset({"github", "archive", "remote"})
# Only a build proves its suite against its environment; edits carry older proofs.
PROVED_ORIGINS = frozenset({"authoring", "extend"})
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


def versioning_enabled() -> bool:
    return bool(getattr(settings, "HARNESS_VERSIONING_ENABLED", False))


def environment_head(job: HostedHarnessJob) -> HostedHarnessJob:
    """The environment a job belongs to, read fresh: a cached relation can be stale."""
    if job.environment_id is None:
        return job
    return HostedHarnessJob.no_workspace_objects.get(id=job.environment_id)


def is_versioned(job: HostedHarnessJob) -> bool:
    """Whether this environment's archive writes go through versions."""
    if not versioning_enabled():
        return False
    return environment_head(job).environment_version_id is not None


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
    model: Any, job: HostedHarnessJob, *, hash: str, values: dict[str, Any]
) -> tuple[Any, bool]:
    """An active version with this hash: the existing one, or a new one numbered next."""
    existing = (
        model.no_workspace_objects.filter(
            job=job,
            hash=hash,
            hash_kind=HashKind.TREE_V1,
            status=VersionStatus.ACTIVE,
        )
        .order_by("-version_number")
        .first()
    )
    if existing is not None:
        return existing, False
    created = model.no_workspace_objects.create(
        job=job,
        organization_id=job.organization_id,
        workspace_id=job.workspace_id,
        status=VersionStatus.ACTIVE,
        version_number=_next_number(model, job),
        hash=hash,
        hash_kind=HashKind.TREE_V1,
        **values,
    )
    return created, True


def _member_rows(
    job: HostedHarnessJob, documents: list[dict[str, Any]]
) -> list[tuple[HostedHarnessScenario, dict[str, Any]]]:
    from simulate.services.harness_scenarios import index_scenarios
    from simulate.services.hosted_harness_gateway import _scenario_token

    index_scenarios(job, documents, prune=True)
    held = list(HostedHarnessScenario.no_workspace_objects.filter(job=job))
    # Keys first, so one row's name never shadows another row's key.
    rows = {token: row for row in held if (token := _scenario_token(row.scenario_key))}
    for row in held:
        if token := _scenario_token(row.name):
            rows.setdefault(token, row)
    paired: list[tuple[HostedHarnessScenario, dict[str, Any]]] = []
    seen: set[Any] = set()
    for document in documents:
        row = rows.get(_scenario_token(document.get("scenario_key"))) or rows.get(
            _scenario_token(document.get("name"))
        )
        if row is not None and row.id not in seen:
            seen.add(row.id)
            paired.append((row, document))
    return paired


def _validation(
    suite_version: HarnessSuiteVersion,
    environment_version: HarnessEnvironmentVersion,
    proofs: object,
    paired: list[tuple[HostedHarnessScenario, dict[str, Any]]],
    job: HostedHarnessJob,
) -> None:
    """Record the build's proofs of this suite against this environment.

    Only proofs the build just made count: an edited suite or a changed environment
    carries proofs made against other content.
    """
    # TODO: require each proof's environment_hash once ALK writes it.
    if not isinstance(proofs, dict) or not paired:
        return
    from simulate.services.hosted_harness_gateway import _scenario_token

    by_token = {
        _scenario_token(key): value
        for key, value in proofs.items()
        if isinstance(value, dict)
    }
    kept: dict[str, Any] = {}
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
    user=None,
    expected_pair_key: str | None = None,
) -> RecordedVersions | None:
    """Version an environment head's authoring archive and make it the default pair.

    Unchanged pieces reuse their active version. Run jobs and environments built while
    versioning is off are left to the legacy single archive. ``expected_pair_key`` is the
    pair an edit was made against; a newer default refuses the edit instead of losing it.
    """
    if not versioning_enabled() or job.environment_id is not None:
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
    connector = str((payload.get("agent") or {}).get("connector") or "")
    sealed = _sealed(split, metadata)

    environment_body = archives.pack_archive(split.environment)
    suite_body = archives.pack_archive(split.suite)
    pair_body = archives.pack_archive(
        archives.compose(split.environment, split.suite, sealed)
    )
    environment_key = archives.environment_key(
        job.organization_id, job.id, environment_body
    )
    suite_key = archives.suite_key(job.organization_id, job.id, suite_body)
    pair_key = archives.pair_key(job.organization_id, job.id, pair_body)
    archives.put_archive(environment_key, environment_body)
    archives.put_archive(suite_key, suite_body)
    archives.put_archive(pair_key, pair_body)
    sealed_key = ""
    if sealed:
        sealed_body = archives.pack_archive(sealed)
        sealed_key = archives.sealed_key(job.organization_id, job.id, sealed_body)
        archives.put_archive(sealed_key, sealed_body)

    contract = _json(split.environment, "contract.json") or {}
    sub_goals = _sub_goals(split.environment)
    sub_goal_digests = hashing.sub_goal_digests(sub_goals)
    file_digests = _file_digests(split.environment)
    documents = suite_documents(split.suite)
    outputs = _stage_outputs(pair_body)
    environment_hash = hashing.environment_hash(
        split.environment, provider_agent=_provider_agent(payload)
    )
    suite_hash = hashing.suite_hash(split.suite)

    with transaction.atomic():
        locked = HostedHarnessJob.no_workspace_objects.select_for_update().get(
            id=job.id
        )
        current_pair = ((locked.payload or {}).get("metadata") or {}).get(
            "authoring_object_key"
        )
        if expected_pair_key is not None and current_pair != expected_pair_key:
            raise HostedHarnessError(
                "version_conflict",
                "the environment changed while this edit was being saved",
                status_code=409,
            )
        base_environment = locked.environment_version
        base_suite = locked.suite_version
        environment_diff = None
        if base_environment is not None:
            previous = base_environment.documents or {}
            environment_diff = diffs.environment_diff(
                previous_contract=previous.get("contract"),
                contract=contract,
                previous_sub_goals=previous.get("sub_goal_digests") or {},
                sub_goals=sub_goal_digests,
                previous_files=previous.get("file_digests") or {},
                files=file_digests,
            )
        environment_version, _ = _land(
            HarnessEnvironmentVersion,
            locked,
            hash=environment_hash,
            values={
                "origin": origin,
                "archive_object_key": environment_key,
                "archive_sha256": archives.sha256_hex(environment_body),
                "archive_size": len(environment_body),
                "parent": base_environment,
                "summary": diffs.summarize_environment(environment_diff),
                "diff": environment_diff,
                "documents": {
                    "contract": contract,
                    "sub_goals": sub_goals,
                    "sub_goal_digests": sub_goal_digests,
                    "file_digests": file_digests,
                    "stage_outputs": [
                        one
                        for one in outputs
                        if one.get("kind") not in SUITE_OUTPUT_KINDS
                    ],
                },
                "contract_hash_raw": hashing.contract_hash_raw(split.environment),
                "world_ir_hash": hashing.world_ir_hash(split.environment),
                # TODO: the build's own agent version once environment creation pins it.
                "agent_version_id": locked.agent_version_id,
                "created_by": user,
            },
        )
        suite_diff = None
        if base_suite is not None:
            suite_diff = diffs.suite_diff(
                (base_suite.documents or {}).get("scenarios") or [], documents
            )
        suite_version, suite_created = _land(
            HarnessSuiteVersion,
            locked,
            hash=suite_hash,
            values={
                "origin": origin,
                "archive_object_key": suite_key,
                "archive_sha256": archives.sha256_hex(suite_body),
                "archive_size": len(suite_body),
                "parent": base_suite,
                "summary": diffs.summarize_suite(suite_diff),
                "diff": suite_diff,
                "documents": {
                    "scenarios": documents,
                    "coverage": _json(split.suite, "coverage.json"),
                    "stage_outputs": [
                        one for one in outputs if one.get("kind") in SUITE_OUTPUT_KINDS
                    ],
                },
                "certify_hash": hashing.suite_certify_hash(
                    split.suite, keep_overlay=connector == "retell_chat"
                ),
                "scenario_count": len(documents),
                "authored_against": environment_version,
                "created_by": user,
            },
        )
        paired = _member_rows(locked, documents)
        if suite_created:
            HarnessSuiteMember.no_workspace_objects.bulk_create(
                [
                    HarnessSuiteMember(
                        suite_version=suite_version,
                        scenario=row,
                        scenario_key=row.scenario_key,
                        number=row.number,
                        content={
                            field: document[field]
                            for field in MEMBER_FIELDS
                            if field in document
                        },
                    )
                    for row, document in paired
                ]
            )
        if origin in PROVED_ORIGINS:
            _validation(
                suite_version,
                environment_version,
                _json(split.suite, "proofs.json"),
                paired,
                locked,
            )

        payload = dict(locked.payload or {})
        metadata = dict(payload.get("metadata") or {})
        metadata["authoring_object_key"] = pair_key
        # TODO: chat compares this content digest; it can become the version pair at step 13.
        metadata["authoring_revision"] = authoring_content_digest(pair_body)
        if sealed_key:
            metadata["sealed_bundle_object_key"] = sealed_key
        payload["metadata"] = metadata
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
    job: HostedHarnessJob, body: bytes, *, origin: str, user=None
) -> RecordedVersions | None:
    """``record_authoring`` for paths that must never fail because of versioning."""
    try:
        return record_authoring(job, body, origin=origin, user=user)
    except Exception:  # noqa: BLE001 - the legacy archive stays authoritative
        logger.exception("could not record versions job=%s origin=%s", job.id, origin)
        return None
