"""Start Insights report workflows."""

from tfc.temporal.common.client import start_workflow_sync
from tfc.temporal.insights.types import InsightRunInput
from tfc.temporal.insights.workflows import InsightReportWorkflow


def workflow_id_for(run_id) -> str:
    return f"insight-run-{run_id}"


def start_insight_run(run_id: str, task_queue: str = "tasks_xl") -> str:
    workflow_id = workflow_id_for(run_id)
    start_workflow_sync(
        InsightReportWorkflow,
        InsightRunInput(run_id=str(run_id)),
        workflow_id=workflow_id,
        task_queue=task_queue,
        cancel_existing=False,
    )
    return workflow_id


async def describe_insight_run_async(workflow_id: str) -> str:
    """Whether a report's workflow still runs: ``WF_PROGRESSING``, or
    ``WF_CLOSED`` / ``WF_ABSENT`` when nothing is working on the report (as
    for an eval task's workflow). An unreachable Temporal raises."""
    from temporalio.client import WorkflowExecutionStatus
    from temporalio.service import RPCError, RPCStatusCode

    from tfc.temporal.common.client import get_client
    from tfc.temporal.eval_tasks.client import WF_ABSENT, WF_CLOSED, WF_PROGRESSING

    client = await get_client()
    try:
        description = await client.get_workflow_handle(workflow_id).describe()
    except RPCError as exc:
        if exc.status == RPCStatusCode.NOT_FOUND:
            return WF_ABSENT
        raise
    if description.status == WorkflowExecutionStatus.RUNNING:
        return WF_PROGRESSING
    return WF_CLOSED


def describe_insight_run_sync(workflow_id: str) -> str:
    from tfc.temporal.common.client import _run_async_in_sync_context

    return _run_async_in_sync_context(lambda: describe_insight_run_async(workflow_id))
