"""Start Analyse report workflows."""

from tfc.temporal.analyse.types import AnalyseRunInput
from tfc.temporal.analyse.workflows import AnalyseReportWorkflow
from tfc.temporal.common.client import start_workflow_sync


def start_analyse_run(run_id: str, task_queue: str = "tasks_xl") -> str:
    workflow_id = f"analyse-run-{run_id}"
    start_workflow_sync(
        AnalyseReportWorkflow,
        AnalyseRunInput(run_id=str(run_id)),
        workflow_id=workflow_id,
        task_queue=task_queue,
        cancel_existing=False,
    )
    return workflow_id
