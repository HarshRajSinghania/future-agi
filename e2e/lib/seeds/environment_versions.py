"""Seeds versioned harness environments for the simulate E2E flows.

Copied into the backend container and run there by ``e2e/lib/environment-seed.ts``:

    python environment_versions.py <environment|edit|finished-run>

Inputs are environment variables; every row belongs to ``SEED_ORG_ID`` /
``SEED_WORKSPACE_ID``. The credential value is read from ``SEED_SECRET_VALUE``
only and never printed. Prints one JSON line; on a failed precondition it
prints one line to stderr and exits non-zero.

Self-contained: the backend image ships without the test suites.
"""

import io
import json
import os
import sys
import uuid
from hashlib import sha256

VARIABLE_NAME = "E2E_GREETING"
SCENARIO_NAMES = (
    "refund_order",
    "cancel_order",
    "track_order",
    "change_address",
    "update_payment",
)
EXTRA_SCENARIO = "reorder_item"
EXTRA_TOOL = {"name": "lookup_order", "description": "find an order by id"}


class SeedError(Exception):
    def __init__(self, code: int, reason: str):
        super().__init__(reason)
        self.code = code


def _key(name: str) -> str:
    return name.replace("_", "-")


def _scenario(name: str) -> dict:
    return {
        "name": name,
        "scenario_key": _key(name),
        "instruction": f"call about {name}",
        "tests": "t",
    }


def _sealed_files(scenarios_json: bytes) -> dict:
    """A sealed bundle whose certificate is for it: the cache only takes those."""
    digest = "sha256:" + sha256(scenarios_json).hexdigest()
    return {
        "environment-bundle/manifest.json": json.dumps(
            {"files": [], "digest": digest}
        ).encode(),
        "runtime-validation.json": json.dumps(
            {"status": "passed", "compiler": {"bundle_digest": digest}}
        ).encode(),
    }


def _with_scenarios(files: dict, names: list) -> dict:
    files = {
        path: data
        for path, data in files.items()
        if not path.startswith("scenarios/") and path != "scenarios.json"
    }
    documents = [_scenario(name) for name in names]
    files["scenarios.json"] = json.dumps(documents).encode()
    for document in documents:
        folder = f"scenarios/{document['name']}"
        files[f"{folder}/scenario.json"] = json.dumps(document).encode()
        files[f"{folder}/ready.py"] = b"def ready(world):\n    return True\n"
    return files


def authoring_archive(names: list) -> bytes:
    from simulate.services.harness_versioning import archives

    files = {
        "contract.json": json.dumps({"agent": "support", "tools": []}).encode(),
        "sub_goals.json": json.dumps(
            {"sub_goals": [{"name": "refunded", "what": "a refund was issued"}]}
        ).encode(),
        "schema.sql": b"create table orders(id int);",
        "handlers/lookup.py": b"def handle(db):\n    return {}\n",
    }
    files = _with_scenarios(files, names)
    files.update(_sealed_files(files["scenarios.json"]))
    return archives.pack_archive(files)


def _scope(organization_id: str, workspace_id: str):
    from accounts.models import Organization
    from accounts.models.workspace import Workspace

    organization = Organization.objects.filter(id=organization_id).first()
    workspace = Workspace.objects.filter(
        id=workspace_id, organization_id=organization_id
    ).first()
    if organization is None or workspace is None:
        raise SeedError(1, "organization or workspace not found")
    return organization, workspace


def _environment(organization, environment_id: str):
    from simulate.models import HostedHarnessJob

    environment = HostedHarnessJob.no_workspace_objects.filter(
        id=environment_id,
        organization=organization,
        environment__isnull=True,
        deleted=False,
    ).first()
    if environment is None:
        raise SeedError(2, "environment not found in this organization")
    return environment


def _payload(name: str, source_id: str, secret_refs: dict, count: int) -> dict:
    return {
        "schema_version": "futureagi.harness-job.v1",
        "source": {"kind": "archive", "archive_artifact_id": source_id},
        "agent": {"connector": "auto", "config": {}, "secret_refs": secret_refs},
        "scenario_count": count,
        "seed": 42,
        "runtime": {
            "isolation": "dedicated_vm",
            "cpu_units": 4,
            "memory_mb": 8192,
            "parallelism": 1,
            "concurrency_weight": 1,
            "max_duration_seconds": 600,
            "network_policy": "live",
        },
        "security": {
            "untrusted_source": True,
            "read_only_source": True,
            "allow_privileged": False,
            "allow_host_runtime_control": False,
            "allowed_egress_domains": ["api.example.com"],
        },
        "retry": {
            "max_infrastructure_attempts": 2,
            "initial_backoff_seconds": 1,
            "max_backoff_seconds": 15,
            "retryable_domains": ["infrastructure"],
        },
        "artifacts": {
            "level": "full",
            "retention_days": 30,
            "allow_bundle_download": False,
            "max_artifact_bytes": 1024,
        },
        "metadata": {"name": name},
    }


def _definition(organization, workspace, agent_definition_id, name):
    from simulate.models import AgentDefinition, AgentVersion

    if agent_definition_id:
        definition = AgentDefinition.objects.filter(
            id=agent_definition_id, organization=organization
        ).first()
        if definition is None:
            raise SeedError(1, "agent definition not found in this organization")
        return definition
    definition = AgentDefinition.objects.create(
        agent_name=name,
        agent_type=AgentDefinition.AgentTypeChoices.VOICE,
        inbound=True,
        description="e2e environment versions seed",
        organization=organization,
        workspace=workspace,
        languages=["en"],
    )
    AgentVersion.no_workspace_objects.create(
        agent_definition=definition,
        organization=organization,
        workspace=workspace,
        description="e2e agent v1",
        commit_message="e2e agent v1",
        status=AgentVersion.StatusChoices.ACTIVE,
    )
    return definition


def _ids(model, environment) -> list:
    return [
        str(one)
        for one in model.no_workspace_objects.filter(job=environment)
        .order_by("version_number")
        .values_list("id", flat=True)
    ]


def seed_environment(
    organization,
    workspace,
    *,
    secret_value: str,
    suffix: str,
    scenarios: int = 3,
    agent_definition_id: str | None = None,
) -> dict:
    """A pre-versioning environment, then the real backfill: A1, E1 and S1 with a
    ready cached bundle for (A1, E1, S1)."""
    from simulate.models import (
        HarnessAgentVersionRuntime,
        HarnessEnvironmentVersion,
        HarnessSuiteVersion,
        HostedHarnessJob,
        RunTest,
    )
    from simulate.services.harness_credentials import mint_secret_refs
    from simulate.services.harness_versioning import archives
    from simulate.services.harness_versioning.assembly import bundle_ready
    from simulate.services.harness_versioning.backfill import (
        backfill_environment,
        effective_runtime,
    )
    from simulate.services.harness_versioning.versions import versioning_enabled
    from simulate.services.hosted_harness import (
        create_hosted_job,
        provision_scenarios,
        register_attempt,
    )
    from simulate.services.hosted_harness_gateway import (
        authoring_content_digest,
        store_source_archive,
    )

    if versioning_enabled():
        raise SeedError(1, "the legacy shape must be seeded with versioning off")
    if not 1 <= scenarios <= len(SCENARIO_NAMES):
        raise SeedError(1, f"scenarios must be 1..{len(SCENARIO_NAMES)}")
    names = list(SCENARIO_NAMES[:scenarios])
    name = f"e2e-env-{suffix}"
    source = store_source_archive(
        organization, [io.BytesIO(b"print('hi')\n")], ["agent.py"], name
    )
    refs = mint_secret_refs(organization, {VARIABLE_NAME: secret_value})
    job, _ = create_hosted_job(
        organization,
        _payload(name, source["source_id"], refs, len(names)),
        idempotency_key=f"e2e-env-{suffix}",
        workspace=workspace,
    )
    attempt = register_attempt(
        job.id, endpoint_base_url="https://harness.e2e.invalid"
    ).attempt
    provision_scenarios(
        attempt,
        {
            "operation": "provision",
            "name": name,
            "modality": "voice",
            "personas": [
                {
                    "scenario_key": _key(one),
                    "name": one,
                    "role": "customer",
                    "situation": "s",
                    "outcome": "o",
                    "persona": {"name": one},
                }
                for one in names
            ],
        },
    )
    job.refresh_from_db()
    definition = _definition(organization, workspace, agent_definition_id, name)
    RunTest.objects.filter(id=job.run_test_id).update(
        agent_definition=definition, agent_version=None
    )

    body = authoring_archive(names)
    object_key = archives.pair_key(organization.id, job.id, body)
    archives.put_archive(object_key, body)
    payload = dict(job.payload)
    payload["metadata"] = {
        **(payload.get("metadata") or {}),
        "authoring_object_key": object_key,
        "authoring_revision": authoring_content_digest(body),
    }
    job.payload = payload
    job.state = HostedHarnessJob.State.COMPLETED
    job.current_stage = "completed"
    job.save(update_fields=["payload", "state", "current_stage", "updated_at"])
    job.refresh_from_db()
    if job.agent_version_id is not None or job.environment_version_id is not None:
        raise SeedError(3, "the environment was pinned before the backfill")

    result = backfill_environment(job.id)
    job.refresh_from_db()
    if result.outcome != "versioned":
        raise SeedError(4, f"backfill outcome {result.outcome}")
    if None in (job.agent_version_id, job.environment_version_id, job.suite_version_id):
        raise SeedError(4, "backfill left a piece without a default")
    runtime = HarnessAgentVersionRuntime.no_workspace_objects.filter(
        agent_version_id=job.agent_version_id
    ).first()
    if runtime is None:
        raise SeedError(4, "the agent version has no side row")
    runtime = effective_runtime(job, runtime)
    if not bundle_ready(job, runtime, job.environment_version, job.suite_version):
        raise SeedError(4, "no ready cached bundle for the defaults")
    return {
        "environmentId": str(job.id),
        "runTestId": str(job.run_test_id),
        "agentDefinitionId": str(definition.id),
        "agentVersionId": str(job.agent_version_id),
        "environmentVersionIds": _ids(HarnessEnvironmentVersion, job),
        "suiteVersionIds": _ids(HarnessSuiteVersion, job),
        "scenarioKeys": [_key(one) for one in names],
        "variableName": VARIABLE_NAME,
    }


def seed_edit(organization, environment_id: str, *, piece: str, change: str) -> dict:
    """One manual edit of the default pair, recorded as a versioned amend records it."""
    from simulate.services.harness_versioning import archives
    from simulate.services.harness_versioning.versions import record_authoring

    allowed = {
        "environment": {"add-tool"},
        "suite": {"drop-scenario", "add-scenario"},
    }
    if change not in allowed.get(piece, set()):
        raise SeedError(1, f"{piece} cannot take the change {change}")
    environment = _environment(organization, environment_id)
    if environment.environment_version_id is None:
        raise SeedError(1, "the environment has no versions")
    pair_key = (environment.payload.get("metadata") or {}).get("authoring_object_key")
    files = archives.read_archive(archives.get_archive(pair_key))
    names = [one["name"] for one in json.loads(files["scenarios.json"])]
    if change == "add-tool":
        contract = json.loads(files["contract.json"])
        contract["tools"] = [*(contract.get("tools") or []), EXTRA_TOOL]
        files["contract.json"] = json.dumps(contract).encode()
    elif change == "drop-scenario":
        if len(names) < 2:
            raise SeedError(1, "dropping needs at least two scenarios")
        files = _with_scenarios(files, names[:-1])
    else:
        files = _with_scenarios(files, [*names, EXTRA_SCENARIO])
    record_authoring(
        environment,
        archives.pack_archive(files),
        origin="manual",
        expected_pair_key=pair_key,
    )
    environment.refresh_from_db()
    version_id = (
        environment.environment_version_id
        if piece == "environment"
        else environment.suite_version_id
    )
    return {"versionId": str(version_id)}


def seed_finished_run(
    organization,
    environment_id: str,
    *,
    results: list,
    trials: int,
    suffix: str,
    picks: dict | None = None,
) -> dict:
    """A completed run of these picks with planted per-trial sub-goal results."""
    from django.utils import timezone

    from simulate.models import CallExecution, HostedHarnessJob, TestExecution
    from simulate.services.hosted_harness import (
        VersionPicks,
        create_selected_harness_run,
    )

    environment = _environment(organization, environment_id)
    picks = picks or {}
    keys = [one["scenarioKey"] for one in results]
    run, created = create_selected_harness_run(
        environment,
        scenario_keys=keys,
        trials=trials,
        idempotency_key=f"e2e-run-{suffix}",
        picks=VersionPicks(
            agent_version_id=picks.get("agent"),
            environment_version_id=picks.get("environment"),
            suite_version_id=picks.get("suite"),
        ),
    )
    if not created or run.environment_id != environment.id:
        raise SeedError(2, "the run is not this seed's own")
    held = {one["scenarioKey"]: one["held"] for one in results}
    manifest = (run.payload.get("metadata") or {}).get("execution_manifest") or []
    calls = CallExecution.no_workspace_objects.in_bulk(
        [entry["call_execution_id"] for entry in manifest]
    )
    statuses = []
    for entry in manifest:
        call = calls[uuid.UUID(entry["call_execution_id"])]
        key = entry["scenario_key"]
        value = held[key]
        status = "passed" if value else "inconclusive" if value is None else "failed"
        statuses.append(status)
        call.status = "completed"
        call.call_metadata = {
            **(call.call_metadata or {}),
            "harness_scenario_key": key,
            "harness_outcome_status": status,
            "hosted_harness_receipt": {
                "scenario_key": key,
                "status": status,
                "sub_goals": [{"name": "refunded", "held": value}],
            },
        }
        call.save(update_fields=["status", "call_metadata"])
    # As the run's completion and update_execution_counts leave it.
    now = timezone.now()
    TestExecution.objects.filter(id=run.test_execution_id).update(
        status=TestExecution.ExecutionStatus.COMPLETED,
        completed_at=now,
        completed_calls=len(statuses),
        failed_calls=0,
    )
    run.state = HostedHarnessJob.State.COMPLETED
    run.current_stage = "completed"
    run.terminal_at = now
    run.content_updated_at = now
    run.completed_count = statuses.count("passed")
    run.failed_count = statuses.count("failed")
    run.save(
        update_fields=[
            "state",
            "current_stage",
            "terminal_at",
            "content_updated_at",
            "completed_count",
            "failed_count",
            "updated_at",
        ]
    )
    return {"runJobId": str(run.id), "executionId": str(run.test_execution_id)}


def main(argv: list) -> int:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "tfc.settings.settings")
    import django

    django.setup()
    command = argv[1] if len(argv) > 1 else ""
    env = os.environ
    try:
        organization, workspace = _scope(env["SEED_ORG_ID"], env["SEED_WORKSPACE_ID"])
        if command == "environment":
            secret_value = env.get("SEED_SECRET_VALUE") or ""
            if not secret_value:
                raise SeedError(1, "SEED_SECRET_VALUE is not set")
            out = seed_environment(
                organization,
                workspace,
                secret_value=secret_value,
                suffix=env["SEED_SUFFIX"],
                scenarios=int(env.get("SEED_SCENARIOS") or 3),
                agent_definition_id=env.get("SEED_AGENT_DEFINITION_ID") or None,
            )
        elif command == "edit":
            out = seed_edit(
                organization,
                env["SEED_ENVIRONMENT_ID"],
                piece=env["SEED_PIECE"],
                change=env["SEED_CHANGE"],
            )
        elif command == "finished-run":
            out = seed_finished_run(
                organization,
                env["SEED_ENVIRONMENT_ID"],
                results=json.loads(env["SEED_RESULTS"]),
                trials=int(env["SEED_TRIALS"]),
                suffix=env["SEED_SUFFIX"],
                picks=json.loads(env.get("SEED_PICKS") or "{}"),
            )
        else:
            raise SeedError(1, f"unknown subcommand {command!r}")
    except SeedError as exc:
        print(f"seed {command}: {exc}", file=sys.stderr)
        return exc.code
    except KeyError as exc:
        print(f"seed {command}: missing input {exc.args[0]}", file=sys.stderr)
        return 1
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
