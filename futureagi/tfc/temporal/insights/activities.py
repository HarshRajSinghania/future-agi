"""Temporal activities for Insights reports.

Each stage is a thin wrapper around ``ee.agenthub.insights.pipeline``; the
database is the source of truth for progress, so a retried stage picks up
where the last attempt left off. Unexpected errors are logged and surface
as a generic message, never as internals.

Insights is Enterprise-only. Its views check the license on every request,
and each stage checks it again for the run's organization, so a run on an
install without it (the license lapsed, or the run predates the gate) fails
with a clear error instead of reading.
"""

import structlog
from temporalio import activity
from temporalio.exceptions import ApplicationError

from tfc.temporal.insights.types import (
    InsightBatchInput,
    InsightFailInput,
    InsightRunInput,
)

logger = structlog.get_logger(__name__)


def require_license(run_id: str) -> None:
    """Refuse a stage of a run whose organization may not use Insights, or
    whose Turing models it may not call, with a non-retryable error."""
    from tfc.ee_gates import (
        INSIGHTS_DENIED_MESSAGE,
        INSIGHTS_TURING_DENIED_MESSAGE,
        insights_turing_denied,
    )
    from tfc.ee_gating import EEFeature, FeatureUnavailable, check_ee_feature
    from tracer.models.insights import InsightRun

    # Any workspace context: the run's own organization decides.
    org_id = (
        InsightRun.no_workspace_objects.filter(id=run_id)
        .values_list("organization_id", flat=True)
        .first()
    )
    if org_id is None:
        return  # The stage reports the missing run itself.
    try:
        check_ee_feature(EEFeature.INSIGHTS, org_id=str(org_id))
    except FeatureUnavailable:
        raise ApplicationError(
            INSIGHTS_DENIED_MESSAGE, type="CapabilityDenied", non_retryable=True
        ) from None
    if insights_turing_denied(org_id):
        raise ApplicationError(
            INSIGHTS_TURING_DENIED_MESSAGE,
            type="CapabilityDenied",
            non_retryable=True,
        )


def _licensed(fn):
    def call(run_id, *args):
        require_license(run_id)
        return fn(run_id, *args)

    return call


async def _run(stage: str, fn, *args, licensed: bool = True):
    from channels.db import database_sync_to_async

    from ee.agenthub.insights.llm import InsightModelError

    try:
        return await database_sync_to_async(
            _licensed(fn) if licensed else fn, thread_sensitive=False
        )(*args)
    except ApplicationError:
        raise
    except InsightModelError as exc:
        raise ApplicationError(str(exc), non_retryable=not exc.unavailable) from exc
    except Exception as exc:
        logger.exception("insight_stage_failed", stage=stage)
        raise ApplicationError("The report could not be completed.") from exc


@activity.defn
async def insight_prepare(input: InsightRunInput) -> list[int]:
    from ee.agenthub.insights.pipeline import prepare

    return await _run("prepare", prepare, input.run_id)


@activity.defn
async def insight_extract(input: InsightBatchInput) -> dict:
    from ee.agenthub.insights.pipeline import extract_batch

    return await _run("extract", extract_batch, input.run_id, input.unit_pks)


@activity.defn
async def insight_retry_failed(input: InsightRunInput) -> list[int]:
    from ee.agenthub.insights.pipeline import retry_failed

    return await _run("retry", retry_failed, input.run_id)


@activity.defn
async def insight_organise(input: InsightRunInput) -> dict:
    from ee.agenthub.insights.pipeline import organise

    return await _run("organise", organise, input.run_id)


@activity.defn
async def insight_finish(input: InsightRunInput) -> dict:
    from ee.agenthub.insights.pipeline import finish

    return await _run("finish", finish, input.run_id)


@activity.defn
async def insight_fail(input: InsightFailInput) -> None:
    from ee.agenthub.insights.pipeline import fail

    # Recording the failure needs no license: it is how a refused run ends.
    await _run("fail", fail, input.run_id, input.message, licensed=False)
