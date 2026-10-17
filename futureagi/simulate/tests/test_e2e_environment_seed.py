"""The E2E environment-versions seed records what the simulate flows rely on."""

import importlib.util
import json
from pathlib import Path

import pytest

from simulate.models import (
    CallExecution,
    HarnessAgentVersionRuntime,
    HarnessAssembledBundle,
    HostedHarnessJob,
    HostedHarnessSecret,
)
from simulate.models import TestExecution as Execution
from simulate.services.harness_versioning.assembly import bundle_ready
from simulate.services.harness_versioning.backfill import effective_runtime
from simulate.tests.test_harness_versioning_backfill import storage  # noqa: F401

SEED = Path(__file__).resolve().parents[3] / "e2e/lib/seeds/environment_versions.py"
SECRET = "e2e-secret-pytest"

pytestmark = [
    pytest.mark.django_db,
    pytest.mark.skipif(not SEED.exists(), reason="the e2e tree is not checked out"),
]


@pytest.fixture(scope="module")
def seed():
    spec = importlib.util.spec_from_file_location("environment_versions", SEED)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def versioning(settings):
    settings.HARNESS_VERSIONING_ENABLED = False
    return settings


@pytest.fixture
def seeded(seed, user, workspace, storage, versioning):  # noqa: F811
    out = seed.seed_environment(
        user.organization, workspace, secret_value=SECRET, suffix="one"
    )
    versioning.HARNESS_VERSIONING_ENABLED = True
    return out


def _job(out):
    return HostedHarnessJob.no_workspace_objects.get(id=out["environmentId"])


def test_a_backfilled_environment_has_its_defaults_and_a_ready_bundle(seeded):
    environment = _job(seeded)

    assert len(seeded["environmentVersionIds"]) == 1
    assert len(seeded["suiteVersionIds"]) == 1
    assert str(environment.agent_version_id) == seeded["agentVersionId"]
    assert str(environment.environment_version_id) == (
        seeded["environmentVersionIds"][0]
    )
    assert str(environment.suite_version_id) == seeded["suiteVersionIds"][0]
    assert seeded["scenarioKeys"] == ["refund-order", "cancel-order", "track-order"]
    runtime = HarnessAgentVersionRuntime.no_workspace_objects.get(
        agent_version_id=environment.agent_version_id
    )
    assert bundle_ready(
        environment,
        effective_runtime(environment, runtime),
        environment.environment_version,
        environment.suite_version,
    )
    assert HarnessAssembledBundle.no_workspace_objects.get(job=environment).state == (
        "ready"
    )


def test_the_value_is_stored_encrypted_and_never_returned(seeded):
    assert SECRET not in json.dumps(seeded)
    assert seeded["variableName"] == "E2E_GREETING"
    refs = _job(seeded).payload["agent"]["secret_refs"]
    assert list(refs) == ["E2E_GREETING"]
    assert refs["E2E_GREETING"]["manager"] == "platform-vault"
    assert HostedHarnessSecret.objects.filter(name=refs["E2E_GREETING"]["key"]).exists()


def test_a_second_environment_shares_the_first_ones_agent_version(
    seed, seeded, user, workspace, versioning
):
    versioning.HARNESS_VERSIONING_ENABLED = False
    second = seed.seed_environment(
        user.organization,
        workspace,
        secret_value="e2e-secret-other",
        suffix="two",
        agent_definition_id=seeded["agentDefinitionId"],
    )

    assert second["agentVersionId"] == seeded["agentVersionId"]
    assert second["environmentId"] != seeded["environmentId"]


def test_the_legacy_shape_refuses_to_seed_with_versioning_on(
    seed, user, workspace, storage, settings  # noqa: F811
):
    settings.HARNESS_VERSIONING_ENABLED = True

    with pytest.raises(seed.SeedError) as refused:
        seed.seed_environment(
            user.organization, workspace, secret_value=SECRET, suffix="on"
        )

    assert refused.value.code == 1
    assert not HostedHarnessJob.no_workspace_objects.exists()


def test_dropping_a_scenario_records_a_sealed_second_suite_version(seed, seeded, user):
    edit = seed.seed_edit(
        user.organization,
        seeded["environmentId"],
        piece="suite",
        change="drop-scenario",
    )

    environment = _job(seeded)
    assert edit["versionId"] == str(environment.suite_version_id)
    assert edit["versionId"] not in seeded["suiteVersionIds"]
    assert environment.suite_version.version_number == 2
    assert str(environment.environment_version_id) == (
        seeded["environmentVersionIds"][0]
    )
    assert environment.payload["metadata"].get("default_pair_sealed") is not False


def test_adding_a_tool_records_a_second_environment_version(seed, seeded, user):
    edit = seed.seed_edit(
        user.organization,
        seeded["environmentId"],
        piece="environment",
        change="add-tool",
    )

    environment = _job(seeded)
    assert edit["versionId"] == str(environment.environment_version_id)
    assert environment.environment_version.version_number == 2
    assert str(environment.suite_version_id) == seeded["suiteVersionIds"][0]


def test_an_edit_the_piece_cannot_take_is_refused(seed, seeded, user):
    with pytest.raises(seed.SeedError):
        seed.seed_edit(
            user.organization,
            seeded["environmentId"],
            piece="environment",
            change="drop-scenario",
        )


def test_a_finished_run_carries_the_planted_results(seed, seeded, user):
    keys = seeded["scenarioKeys"][:2]

    out = seed.seed_finished_run(
        user.organization,
        seeded["environmentId"],
        results=[
            {"scenarioKey": keys[0], "held": True},
            {"scenarioKey": keys[1], "held": False},
        ],
        trials=2,
        suffix="run",
        picks={"suite": seeded["suiteVersionIds"][0]},
    )

    execution = Execution.objects.get(id=out["executionId"])
    assert execution.status == Execution.ExecutionStatus.COMPLETED
    assert execution.completed_at is not None
    assert (execution.completed_calls, execution.failed_calls) == (4, 0)
    run = HostedHarnessJob.no_workspace_objects.get(id=out["runJobId"])
    assert run.state == HostedHarnessJob.State.COMPLETED
    assert run.current_stage == "completed"
    assert run.terminal_at is not None
    assert (run.completed_count, run.failed_count) == (2, 2)
    assert str(run.suite_version_id) == seeded["suiteVersionIds"][0]
    statuses = sorted(
        (
            call.call_metadata["harness_scenario_key"],
            call.call_metadata["harness_outcome_status"],
        )
        for call in CallExecution.no_workspace_objects.filter(test_execution=execution)
    )
    assert statuses == [
        (keys[1], "failed"),
        (keys[1], "failed"),
        (keys[0], "passed"),
        (keys[0], "passed"),
    ]


def test_another_organizations_environment_is_not_found(seed, seeded):
    from accounts.models import Organization

    other = Organization.objects.create(name="other org")

    with pytest.raises(seed.SeedError) as refused:
        seed.seed_edit(
            other, seeded["environmentId"], piece="suite", change="add-scenario"
        )

    assert refused.value.code == 2


def test_an_undecided_trial_is_planted_inconclusive(seed, seeded, user):
    out = seed.seed_finished_run(
        user.organization,
        seeded["environmentId"],
        results=[{"scenarioKey": seeded["scenarioKeys"][0], "held": None}],
        trials=1,
        suffix="undecided",
    )

    (call,) = CallExecution.no_workspace_objects.filter(
        test_execution_id=out["executionId"]
    )
    assert call.call_metadata["harness_outcome_status"] == "inconclusive"
    run = HostedHarnessJob.no_workspace_objects.get(id=out["runJobId"])
    assert (run.completed_count, run.failed_count) == (0, 0)


@pytest.fixture
def run_main(seed, monkeypatch, capsys):
    monkeypatch.setattr("django.setup", lambda: None)
    for name in ("SEED_ORG_ID", "SEED_WORKSPACE_ID"):
        monkeypatch.delenv(name, raising=False)

    def run(*argv, **env):
        for name, value in env.items():
            monkeypatch.setenv(name, str(value))
        code = seed.main(["environment_versions.py", *argv])
        return code, capsys.readouterr()

    return run


def test_main_prints_one_json_line_for_an_added_scenario(
    run_main, seeded, user, workspace
):
    code, out = run_main(
        "edit",
        SEED_ORG_ID=user.organization.id,
        SEED_WORKSPACE_ID=workspace.id,
        SEED_ENVIRONMENT_ID=seeded["environmentId"],
        SEED_PIECE="suite",
        SEED_CHANGE="add-scenario",
    )

    assert code == 0
    assert out.err == ""
    environment = _job(seeded)
    assert out.out.splitlines() == [
        json.dumps({"versionId": str(environment.suite_version_id)})
    ]
    assert environment.suite_version.version_number == 2
    assert environment.suite_version.scenario_count == 4


def test_main_exits_1_on_a_missing_input(run_main, user):
    code, out = run_main("edit", SEED_ORG_ID=user.organization.id)

    assert code == 1
    assert out.out == ""
    assert out.err == "seed edit: missing input SEED_WORKSPACE_ID\n"


def test_main_exits_1_on_an_unknown_subcommand(run_main, user, workspace):
    code, out = run_main(
        "nudge", SEED_ORG_ID=user.organization.id, SEED_WORKSPACE_ID=workspace.id
    )

    assert code == 1
    assert out.out == ""
    assert out.err == "seed nudge: unknown subcommand 'nudge'\n"


def test_main_exits_with_the_refusal_code(run_main, seeded, user):
    from accounts.models import Organization
    from accounts.models.workspace import Workspace

    other = Organization.objects.create(name="other org")
    other_workspace = Workspace.objects.create(
        name="Other", organization=other, is_active=True, created_by=user
    )

    code, out = run_main(
        "edit",
        SEED_ORG_ID=other.id,
        SEED_WORKSPACE_ID=other_workspace.id,
        SEED_ENVIRONMENT_ID=seeded["environmentId"],
        SEED_PIECE="suite",
        SEED_CHANGE="add-scenario",
    )

    assert code == 2
    assert out.out == ""
    assert out.err.startswith("seed edit: environment not found")
