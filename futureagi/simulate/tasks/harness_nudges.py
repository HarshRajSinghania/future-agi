from __future__ import annotations

from typing import Any

from django.db import close_old_connections

from tfc.temporal.drop_in import temporal_activity

__all__ = [
    "raise_harness_environment_nudge",
    "reconcile_harness_environment_nudges",
    "schedule_nudge",
    "schedule_reconcile_task",
]


@temporal_activity(time_limit=120, max_retries=3, queue="default")
def raise_harness_environment_nudge(
    environment_id: str,
    agent_version_id: str,
    default_moved: bool,
    outgoing_agent_version_id: str | None = None,
) -> str:
    """Raise one environment nudge; the inputs are ids and a flag, values are read here."""
    from simulate.services.harness_versioning.nudges import raise_environment_nudge

    close_old_connections()
    try:
        nudge = raise_environment_nudge(
            environment_id,
            agent_version_id,
            default_moved=default_moved,
            outgoing_agent_version_id=outgoing_agent_version_id,
        )
        return "raised" if nudge is not None else "skipped"
    finally:
        close_old_connections()


@temporal_activity(time_limit=120, max_retries=3, queue="default")
def reconcile_harness_environment_nudges(environment_id: str) -> str:
    """Raise what an environment's busy guards or a lost schedule skipped."""
    from simulate.services.harness_versioning.nudges import (
        reconcile_environment_nudges,
    )

    close_old_connections()
    try:
        return reconcile_environment_nudges(environment_id)
    finally:
        close_old_connections()


def schedule_nudge(
    environment_id: Any,
    agent_version_id: Any,
    default_moved: bool,
    outgoing_agent_version_id: Any = None,
):
    """Start a raise; one per environment, version and kind runs at a time."""
    from temporalio.common import WorkflowIDConflictPolicy

    return raise_harness_environment_nudge.apply_async(
        args=[
            str(environment_id),
            str(agent_version_id),
            bool(default_moved),
            str(outgoing_agent_version_id) if outgoing_agent_version_id else None,
        ],
        task_id=(
            f"harness-nudge-{environment_id}-{agent_version_id}-{int(default_moved)}"
        ),
        id_conflict_policy=WorkflowIDConflictPolicy.USE_EXISTING,
    )


def schedule_reconcile_task(environment_id: Any):
    """Start a reconcile; requests for one environment coalesce while one runs."""
    from temporalio.common import WorkflowIDConflictPolicy

    return reconcile_harness_environment_nudges.apply_async(
        args=[str(environment_id)],
        task_id=f"harness-nudge-reconcile-{environment_id}",
        id_conflict_policy=WorkflowIDConflictPolicy.USE_EXISTING,
    )
