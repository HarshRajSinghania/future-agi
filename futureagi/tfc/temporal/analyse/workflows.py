"""Analyse report workflow: read -> summarise (parallel batches) -> group ->
measure and write."""

import asyncio
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from tfc.temporal.analyse.types import (
        AnalyseBatchInput,
        AnalyseFailInput,
        AnalyseRunInput,
    )

BATCH = 24
PARALLEL_BATCHES = 4
STAGE_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=5),
    maximum_interval=timedelta(seconds=60),
    maximum_attempts=3,
    backoff_coefficient=2.0,
)


@workflow.defn
class AnalyseReportWorkflow:
    async def _extract(self, run_id: str, pks: list[int], parallel: int) -> None:
        batches = [pks[i : i + BATCH] for i in range(0, len(pks), BATCH)]
        for start in range(0, len(batches), parallel):
            await asyncio.gather(
                *(
                    workflow.execute_activity(
                        "analyse_extract",
                        AnalyseBatchInput(run_id=run_id, unit_pks=batch),
                        start_to_close_timeout=timedelta(minutes=10),
                        retry_policy=STAGE_RETRY,
                    )
                    for batch in batches[start : start + parallel]
                )
            )

    @workflow.run
    async def run(self, input: AnalyseRunInput) -> dict:
        try:
            ready = await workflow.execute_activity(
                "analyse_prepare",
                input,
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=STAGE_RETRY,
            )
            await self._extract(input.run_id, ready, PARALLEL_BATCHES)
            # One more pass over units that hit a transient model error,
            # at lower concurrency.
            retry = await workflow.execute_activity(
                "analyse_retry_failed",
                input,
                start_to_close_timeout=timedelta(minutes=1),
                retry_policy=STAGE_RETRY,
            )
            if retry:
                await self._extract(input.run_id, retry, 1)
            await workflow.execute_activity(
                "analyse_organise",
                input,
                start_to_close_timeout=timedelta(minutes=15),
                retry_policy=STAGE_RETRY,
            )
            return await workflow.execute_activity(
                "analyse_finish",
                input,
                start_to_close_timeout=timedelta(minutes=10),
                retry_policy=STAGE_RETRY,
            )
        except ActivityError as exc:
            cause = getattr(exc, "cause", None)
            message = getattr(cause, "message", "") or "The report could not be completed."
            await workflow.execute_activity(
                "analyse_fail",
                AnalyseFailInput(run_id=input.run_id, message=message),
                start_to_close_timeout=timedelta(seconds=30),
            )
            raise
