import copy
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from ai_tools.tests.conftest import run_tool
from ai_tools.tests.fixtures import (
    make_agent_definition,
    make_eval_template,
    make_scenario,
)


def _voice_denial():
    return SimpleNamespace(
        data={
            "message": "Voice simulation requires a higher plan",
            "code": "permission_denied",
            "feature": "voice_sim",
            "upgrade_required": True,
        }
    )


@pytest.fixture
def agent_definition(tool_context):
    return make_agent_definition(tool_context)


# ===================================================================
# READ TOOLS
# ===================================================================


class TestGetAgentTool:
    def test_get_existing(self, tool_context, agent_definition):
        result = run_tool(
            "get_agent",
            {"agent_id": str(agent_definition.id)},
            tool_context,
        )

        assert not result.is_error
        assert "Test Agent" in result.content
        assert result.data["id"] == str(agent_definition.id)

    def test_get_nonexistent(self, tool_context):
        result = run_tool(
            "get_agent",
            {"agent_id": str(uuid.uuid4())},
            tool_context,
        )

        assert result.is_error
        assert "Not Found" in result.content

    def test_get_invalid_uuid(self, tool_context):
        result = run_tool(
            "get_agent",
            {"agent_id": "not-a-uuid"},
            tool_context,
        )

        assert result.is_error


class TestListAgentVersionsTool:
    def test_list_empty(self, tool_context, agent_definition):
        result = run_tool(
            "list_agent_versions",
            {"agent_id": str(agent_definition.id)},
            tool_context,
        )

        assert not result.is_error
        assert result.data["total"] == 0

    def test_list_nonexistent_agent(self, tool_context):
        result = run_tool(
            "list_agent_versions",
            {"agent_id": str(uuid.uuid4())},
            tool_context,
        )

        # May return empty list or error depending on implementation
        # Just verify it doesn't crash
        assert isinstance(result.is_error, bool)


class TestListTestExecutionsTool:
    def test_list_empty(self, tool_context):
        # run_test_id is required; pass a random UUID to get empty results
        result = run_tool(
            "list_test_executions",
            {"run_test_id": str(uuid.uuid4())},
            tool_context,
        )

        assert not result.is_error
        assert result.data["total"] == 0


class TestGetTestExecutionTool:
    def test_get_nonexistent(self, tool_context):
        result = run_tool(
            "get_test_execution",
            {"execution_id": str(uuid.uuid4())},
            tool_context,
        )

        assert result.is_error


class TestGetCallExecutionTool:
    def test_get_nonexistent(self, tool_context):
        result = run_tool(
            "get_call_execution",
            {"execution_id": str(uuid.uuid4())},
            tool_context,
        )

        assert result.is_error


# ===================================================================
# RUN TOOL — voice-sim gate
# ===================================================================


def _make_runnable_test(tool_context, *, agent_type):
    """RunTest with an agent definition, active version, and one scenario —
    the minimum for run_agent_test to reach the dispatch path."""
    from simulate.models.agent_version import AgentVersion
    from simulate.models.run_test import RunTest

    agent_definition = make_agent_definition(tool_context, agent_type=agent_type)
    AgentVersion.objects.create(
        agent_definition=agent_definition,
        organization=tool_context.organization,
        workspace=tool_context.workspace,
        version_number=1,
        version_name="v1",
        status=AgentVersion.StatusChoices.ACTIVE,
        configuration_snapshot={"description": "You are a helpful agent."},
    )
    run_test = RunTest.objects.create(
        name="Gate Test Run",
        agent_definition=agent_definition,
        organization=tool_context.organization,
        workspace=tool_context.workspace,
    )
    run_test.scenarios.add(make_scenario(tool_context))
    return run_test


class TestRunAgentTestVoiceGate:
    """The tool mirrors the execute view's voice-sim gate: a build without
    the voice extra must deny VOICE runs up front, before anything is
    persisted or dispatched (TH-4657)."""

    def test_voice_agent_denied_when_gate_denies(self, tool_context):
        from simulate.models.test_execution import TestExecution

        run_test = _make_runnable_test(tool_context, agent_type="voice")

        with (
            patch(
                "tfc.ee_gates.voice_sim_gate_response",
                return_value=_voice_denial(),
            ) as gate,
            patch(
                "simulate.temporal.client.start_test_execution_workflow"
            ) as start_workflow,
        ):
            result = run_tool(
                "run_agent_test", {"run_test_id": str(run_test.id)}, tool_context
            )

        assert result.is_error
        assert result.error_code == "permission_denied"
        assert result.data["feature"] == "voice_sim"
        gate.assert_called_once_with(tool_context.organization)
        start_workflow.assert_not_called()
        # Nothing persisted on deny.
        assert not TestExecution.objects.filter(run_test=run_test).exists()

    def test_voice_agent_runs_when_gate_allows(self, tool_context):
        from simulate.models.test_execution import TestExecution

        run_test = _make_runnable_test(tool_context, agent_type="voice")

        with (
            patch("tfc.ee_gates.voice_sim_gate_response", return_value=None) as gate,
            patch(
                "simulate.temporal.client.start_test_execution_workflow"
            ) as start_workflow,
        ):
            result = run_tool(
                "run_agent_test", {"run_test_id": str(run_test.id)}, tool_context
            )

        assert not result.is_error
        gate.assert_called_once_with(tool_context.organization)
        start_workflow.assert_called_once()
        execution = TestExecution.objects.get(run_test=run_test)
        assert execution.status == TestExecution.ExecutionStatus.RUNNING

    def test_text_agent_bypasses_gate(self, tool_context):
        from simulate.models.test_execution import TestExecution

        run_test = _make_runnable_test(tool_context, agent_type="text")

        with (
            patch(
                "tfc.ee_gates.voice_sim_gate_response",
                return_value=_voice_denial(),
            ) as gate,
            patch(
                "simulate.temporal.client.start_test_execution_workflow"
            ) as start_workflow,
        ):
            result = run_tool(
                "run_agent_test", {"run_test_id": str(run_test.id)}, tool_context
            )

        assert not result.is_error
        gate.assert_not_called()
        start_workflow.assert_called_once()
        assert TestExecution.objects.filter(run_test=run_test).exists()


@pytest.mark.django_db
def test_voice_rerun_denied_before_snapshot_or_reset(tool_context):
    from simulate.models.agent_definition import AgentDefinition
    from simulate.models.test_execution import CallExecution, CallExecutionSnapshot

    call = MagicMock()
    call.id = uuid.uuid4()
    call.test_execution.status = "completed"
    call.test_execution.run_test.agent_definition.agent_type = (
        AgentDefinition.AgentTypeChoices.VOICE
    )
    call.transcripts = MagicMock()

    queryset = MagicMock()
    queryset.get.return_value = call

    with (
        patch.object(CallExecution.objects, "select_related", return_value=queryset),
        patch.object(CallExecutionSnapshot.objects, "create") as create_snapshot,
        patch(
            "tfc.ee_gates.voice_sim_gate_response", return_value=_voice_denial()
        ) as gate,
        patch("simulate.temporal.client.rerun_call_executions") as rerun,
    ):
        result = run_tool(
            "rerun_call_execution",
            {"call_execution_id": str(call.id), "rerun_type": "call_and_eval"},
            tool_context,
        )

    assert result.is_error
    assert result.error_code == "permission_denied"
    gate.assert_called_once_with(tool_context.organization)
    create_snapshot.assert_not_called()
    call.transcripts.all.return_value.delete.assert_not_called()
    call.reset_to_default.assert_not_called()
    rerun.assert_not_called()


# ===================================================================
# RERUN TOOLS — eval-only keeps what the harness wrote
# ===================================================================


def _run_test_with_a_harness_column(tool_context):
    """A run test with one eval the harness fills (an empty mapping) and one
    the platform grades (a mapping of its own)."""
    from simulate.models import SimulateEvalConfig
    from simulate.models.run_test import RunTest

    run_test = RunTest.objects.create(
        name="Eval Only Rerun",
        agent_definition=make_agent_definition(tool_context),
        organization=tool_context.organization,
        workspace=tool_context.workspace,
    )
    run_test.scenarios.add(make_scenario(tool_context))
    filled, own = (
        SimulateEvalConfig.objects.create(
            name=name,
            eval_template=make_eval_template(
                tool_context,
                name=f"{name} template",
                config={
                    "required_keys": list(mapping) or ["conversation"],
                    "output": "Pass/Fail",
                },
            ),
            run_test=run_test,
            config={},
            mapping=mapping,
        )
        for name, mapping in (
            ("Task completion", {}),
            ("Mapped", {"output": "transcript"}),
        )
    )
    return run_test, filled, own


def _call_the_harness_scored(run_test, filled, own):
    """A finished call, in an execution of its own, that an SDK harness run
    scored: the receipt is on the call, and the call holds a code check with
    no eval behind it, the harness's verdict under the eval it fills, and a
    platform verdict under the eval with a mapping of its own.

    Returns the call and the code check's key."""
    from simulate.models.test_execution import CallExecution, TestExecution

    execution = TestExecution.objects.create(
        run_test=run_test,
        status=TestExecution.ExecutionStatus.COMPLETED,
        total_scenarios=1,
        total_calls=1,
    )
    code_check = str(uuid.uuid4())
    call = CallExecution.objects.create(
        test_execution=execution,
        scenario=run_test.scenarios.get(),
        phone_number="+1234567890",
        status=CallExecution.CallStatus.COMPLETED,
        eval_outputs={
            code_check: {
                "name": "ends_call_on_goodbye",
                "output": "Passed",
                "output_type": "Pass/Fail",
                "reason": "said goodbye",
                "status": "completed",
                "source": "harness",
                "kind": "checkpoint",
            },
            str(filled.id): {
                "name": filled.name,
                "output": "Passed",
                "output_type": "Pass/Fail",
                "reason": "the caller's task was done",
                "status": "completed",
                "source": "harness",
            },
            str(own.id): {
                "output": "Passed",
                "reason": "ok",
                "output_type": "Pass/Fail",
                "name": own.name,
            },
        },
        call_metadata={
            "eval_started": True,
            "eval_completed": True,
            "harness_evaluations": [
                {"name": "ends_call_on_goodbye", "kind": "checkpoint", "passed": True}
            ],
        },
    )
    # Compare later against what the database holds, not what was assigned.
    call.refresh_from_db()
    return call, code_check


@pytest.mark.django_db
def test_rerun_call_execution_eval_only_keeps_harness_columns(tool_context):
    """Re-running one call's evals through the assistant leaves every row the
    harness wrote as it was and marks pending only the eval the platform
    grades."""
    from simulate.models.test_execution import CallExecutionSnapshot

    run_test, filled, own = _run_test_with_a_harness_column(tool_context)
    call, code_check = _call_the_harness_scored(run_test, filled, own)
    outputs_before = copy.deepcopy(call.eval_outputs)

    with patch(
        "simulate.temporal.client.rerun_call_executions",
        return_value={"workflow_id": "wf", "merged": False},
    ) as rerun:
        result = run_tool(
            "rerun_call_execution",
            {"call_execution_id": str(call.id), "rerun_type": "eval_only"},
            tool_context,
        )

    assert not result.is_error
    rerun.assert_called_once()
    call.refresh_from_db()
    outputs = call.eval_outputs
    assert outputs[code_check] == outputs_before[code_check]
    assert outputs[str(filled.id)] == outputs_before[str(filled.id)]
    assert outputs[str(own.id)] == {"status": "pending"}
    assert outputs == {**outputs_before, str(own.id): {"status": "pending"}}
    assert call.call_metadata["eval_started"] is False
    assert call.call_metadata["eval_completed"] is False
    snapshot = CallExecutionSnapshot.objects.get(call_execution=call)
    assert snapshot.rerun_type == "eval_only"
    assert snapshot.eval_outputs == outputs_before


@pytest.mark.django_db
@pytest.mark.parametrize("tool", ["rerun_call_execution", "rerun_test_execution"])
def test_eval_only_rerun_on_a_call_the_harness_did_not_score_pends_every_eval(
    tool, tool_context
):
    """On a call that carries no harness receipt, on a run test no harness
    owns, the assistant's re-run marks every eval of the run test pending,
    the one with an empty mapping included, and keeps the row no eval stands
    behind."""
    run_test, filled, own = _run_test_with_a_harness_column(tool_context)
    call, _ = _call_the_harness_scored(run_test, filled, own)
    del call.call_metadata["harness_evaluations"]
    call.save(update_fields=["call_metadata"])
    outputs_before = copy.deepcopy(call.eval_outputs)
    params = {
        "rerun_call_execution": {"call_execution_id": str(call.id)},
        "rerun_test_execution": {"run_test_id": str(run_test.id), "select_all": True},
    }[tool]

    with patch(
        "simulate.temporal.client.rerun_call_executions",
        return_value={"workflow_id": "wf", "merged": False},
    ):
        result = run_tool(tool, {**params, "rerun_type": "eval_only"}, tool_context)

    assert not result.is_error
    call.refresh_from_db()
    assert call.eval_outputs == {
        **outputs_before,
        str(filled.id): {"status": "pending"},
        str(own.id): {"status": "pending"},
    }


@pytest.mark.django_db
def test_rerun_test_execution_eval_only_keeps_harness_columns(tool_context):
    """Re-running a run test's evals through the assistant follows the same
    rule on every call, and reads which evals the platform grades once for
    the run test, not once per call."""
    from simulate.models.test_execution import CallExecutionSnapshot
    from simulate.services.harness_evals import platform_graded_evals

    run_test, filled, own = _run_test_with_a_harness_column(tool_context)
    calls = [_call_the_harness_scored(run_test, filled, own) for _ in range(2)]
    before = {call.id: copy.deepcopy(call.eval_outputs) for call, _ in calls}

    with (
        patch(
            "simulate.temporal.client.rerun_call_executions",
            return_value={"workflow_id": "wf", "merged": False},
        ),
        patch(
            "simulate.services.harness_evals.platform_graded_evals",
            wraps=platform_graded_evals,
        ) as read_graded_evals,
    ):
        result = run_tool(
            "rerun_test_execution",
            {
                "run_test_id": str(run_test.id),
                "select_all": True,
                "rerun_type": "eval_only",
            },
            tool_context,
        )

    assert not result.is_error
    assert result.data["overall_success_count"] == 2
    assert result.data["overall_failure_count"] == 0
    assert read_graded_evals.call_count == 1
    for call, code_check in calls:
        outputs_before = before[call.id]
        call.refresh_from_db()
        outputs = call.eval_outputs
        assert outputs[code_check] == outputs_before[code_check]
        assert outputs[str(filled.id)] == outputs_before[str(filled.id)]
        assert outputs[str(own.id)] == {"status": "pending"}
        assert outputs == {**outputs_before, str(own.id): {"status": "pending"}}
        assert call.call_metadata["eval_started"] is False
        assert call.call_metadata["eval_completed"] is False
        snapshot = CallExecutionSnapshot.objects.get(call_execution=call)
        assert snapshot.rerun_type == "eval_only"
        assert snapshot.eval_outputs == outputs_before
