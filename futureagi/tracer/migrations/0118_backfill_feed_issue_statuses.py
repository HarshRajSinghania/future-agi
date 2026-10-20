"""Provision workspace policies and deterministically initialize proven-system issues.

Unknown legacy ownership is deliberately preserved: the old default and the
absence of grouping protection cannot prove that a user never chose a status.
No external services, application models, or mutable evaluator imports.
"""

from datetime import timedelta

from django.db import migrations, transaction
from django.db.models import Count, F, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from ._feed_escalation_v1 import (
    ALGORITHM_VERSION,
    POLICY_FIELDS,
    Counts,
    Policy,
    evaluate,
    settled_boundary,
)

MIGRATION_ID = "0112-feed-escalation-v1"
BATCH = 100


def migration_now():
    return timezone.now()


def _counts(apps, alias, issue, boundary):
    members = (
        apps.get_model("tracer", "ErrorClusterTraces")
        .objects.using(alias)
        .filter(
            cluster_id=issue.pk,
            deleted=False,
        )
    )
    grouping = (
        apps.get_model("tracer", "TraceGroupingIssueState")
        .objects.using(alias)
        .filter(cluster_id=issue.pk)
        .exists()
    )
    if issue.source == "scanner" and grouping:
        qs = members.filter(
            finding__deleted=False,
            finding__cluster_id=issue.pk,
            trace_id=F("finding__report__trace_id"),
            finding__report__project_id=issue.project_id,
            finding__report__organization_id=issue.project.organization_id,
            finding__report__workspace_id=issue.project.workspace_id,
            finding__report__source="omega",
            finding__report__deleted=False,
            finding__report__is_current=True,
            finding__report__execution_status="completed",
            finding__report__grouping_status="completed",
        )
        identity, trace = "finding_id", "trace_id"
    elif issue.source == "scanner":
        qs = (
            apps.get_model("tracer", "TraceScanIssue")
            .objects.using(alias)
            .filter(
                cluster_id=issue.pk,
                deleted=False,
                scan_result__deleted=False,
                scan_result__status="completed",
                scan_result__project_id=issue.project_id,
            )
        )
        identity, trace = "id", "scan_result__trace_id"
    elif issue.source == "eval":
        target = {
            "span": "observation_span_id",
            "trace": "trace_id",
            "session": "trace_session_id",
        }.get(issue.eval_target_type)
        if target is None:
            raise ValueError("migration_unsupported_eval_target")
        latest = (
            apps.get_model("tracer", "EvalLogger")
            .objects.using(alias)
            .annotate(
                canonical_version=Coalesce("config_hash", Value("")),
            )
            .filter(
                deleted=False,
                custom_eval_config_id=OuterRef("eval_logger__custom_eval_config_id"),
                target_type=issue.eval_target_type,
                status="completed",
                error=False,
                skipped_reason__isnull=True,
                canonical_version=OuterRef("canonical_version"),
                **{target: OuterRef(f"eval_logger__{target}")},
            )
            .order_by("-created_at", "-id")
            .values("id")[:1]
        )
        qs = (
            members.filter(
                eval_logger__deleted=False,
                eval_logger__status="completed",
                eval_logger__error=False,
                eval_logger__skipped_reason__isnull=True,
                eval_logger__custom_eval_config__project_id=issue.project_id,
                eval_logger__target_type=issue.eval_target_type,
            )
            .annotate(
                canonical_version=Coalesce("eval_logger__config_hash", Value("")),
                latest_logger_id=Subquery(latest),
            )
            .filter(eval_logger_id=F("latest_logger_id"))
            .exclude(eval_logger__output_bool=True)
        )
        if qs.filter(occurred_at__isnull=True).exists():
            raise ValueError("migration_missing_timestamps")
        # Config/version + target, not retry execution identity. Trace evals
        # intentionally ignore their supporting root-span reference.
        current, historical, traces = set(), set(), set()
        for row in (
            qs.filter(
                created_at__lte=boundary,
                occurred_at__gte=boundary - timedelta(hours=25),
                occurred_at__lt=boundary,
            )
            .values(
                "occurred_at",
                "trace_id",
                "eval_logger__custom_eval_config_id",
                "eval_logger__config_hash",
                f"eval_logger__{target}",
            )
            .iterator(chunk_size=500)
        ):
            key = (
                row["eval_logger__custom_eval_config_id"],
                row["eval_logger__config_hash"] or "",
                row[f"eval_logger__{target}"],
            )
            if row["occurred_at"] >= boundary - timedelta(hours=1):
                current.add(key)
                if row["trace_id"]:
                    traces.add(row["trace_id"])
            else:
                historical.add(key)
        return Counts(len(current), len(historical), len(traces), "failed_evaluations")
    else:
        raise ValueError("migration_unsupported_source")
    if qs.filter(occurred_at__isnull=True).exists():
        raise ValueError("migration_missing_timestamps")
    totals = qs.filter(created_at__lte=boundary).aggregate(
        current=Count(
            identity,
            distinct=True,
            filter=Q(
                occurred_at__gte=boundary - timedelta(hours=1), occurred_at__lt=boundary
            ),
        ),
        historical=Count(
            identity,
            distinct=True,
            filter=Q(
                occurred_at__gte=boundary - timedelta(hours=25),
                occurred_at__lt=boundary - timedelta(hours=1),
            ),
        ),
        traces=Count(
            trace,
            distinct=True,
            filter=Q(
                occurred_at__gte=boundary - timedelta(hours=1), occurred_at__lt=boundary
            ),
        ),
    )
    return Counts(totals["current"], totals["historical"], totals["traces"])


def backfill_feed_issue_statuses(apps, schema_editor):
    alias = schema_editor.connection.alias
    PolicyRow = apps.get_model("tracer", "FeedEscalationPolicy")
    Workspace = apps.get_model("accounts", "Workspace")
    Issue = apps.get_model("tracer", "TraceErrorGroup")
    Membership = apps.get_model("tracer", "ErrorClusterTraces")
    Finding = apps.get_model("tracer", "TraceInvestigationFinding")
    Grouping = apps.get_model("tracer", "TraceGroupingIssueState")
    Scope = apps.get_model("tracer", "TraceGroupingScope")
    now = migration_now()
    cutoff = settled_boundary(now)
    for workspace_id in (
        Workspace.objects.using(alias)
        .filter(deleted=False)
        .values_list("id", flat=True)
        .iterator(chunk_size=BATCH)
    ):
        PolicyRow.objects.using(alias).get_or_create(workspace_id=workspace_id)
    # Only authoritative local Omega completion timestamps can be recovered
    # here. Other adapters require the separate bounded preparation command.
    source_time = (
        Finding.objects.using(alias)
        .filter(pk=OuterRef("finding_id"))
        .values("report__job__root_end_time")[:1]
    )
    pending = Membership.objects.using(alias).filter(
        occurred_at__isnull=True,
        finding__report__job__root_end_time__isnull=False,
    )
    cursor = None
    while True:
        batch = pending if cursor is None else pending.filter(pk__gt=cursor)
        ids = list(batch.order_by("pk").values_list("pk", flat=True)[:BATCH])
        if not ids:
            break
        pending.filter(pk__in=ids).update(
            occurred_at=Subquery(source_time), occurrence_time_source="omega_root_end"
        )
        cursor = ids[-1]
    base = (
        Issue.objects.using(alias)
        .filter(
            deleted=False,
            target_type="error_feed",
            status_origin="system",
            status__in=["escalating", "for_review"],
            project__workspace__isnull=False,
        )
        .exclude(issue_state__dirty=True)
        .exclude(issue_state__retired=True)
    )
    skipped_unknown = (
        Issue.objects.using(alias)
        .filter(
            deleted=False,
            target_type="error_feed",
            status_origin="legacy_unknown",
        )
        .count()
    )
    cursor, completed = None, 0
    while True:
        qs = base.order_by("id")
        if cursor is not None:
            qs = qs.filter(id__gt=cursor)
        batch = list(qs.select_related("project")[:BATCH])
        if not batch:
            break
        cursor = batch[-1].id
        for snapshot in batch:
            saved = snapshot.escalation_state
            if saved.get("migration_completed") == MIGRATION_ID:
                continue
            row = PolicyRow.objects.using(alias).get(
                workspace_id=snapshot.project.workspace_id
            )
            policy = Policy(
                **{name: getattr(row, name) for name in POLICY_FIELDS},
                revision=row.revision,
            )
            grouping = (
                Grouping.objects.using(alias).filter(cluster_id=snapshot.pk).first()
            )
            membership_revision = grouping.membership_revision if grouping else None
            state, status, reason = {}, "for_review", "migration_initialized"
            counts = None
            try:
                # Available current membership is replayed only after its
                # publication time; a historical import cannot invent earlier
                # confirmation. Already validated episodes retain their state.
                if saved.get("algorithm_version") == ALGORITHM_VERSION and saved.get(
                    "progress"
                ):
                    counts = _counts(apps, alias, snapshot, cutoff)
                    decision = evaluate(
                        status=snapshot.status,
                        origin="system",
                        state=saved["progress"],
                        counts=counts,
                        policy=policy,
                        boundary=cutoff,
                        input_revision=saved.get("pending_input_revision", 0),
                    )
                    status, state = decision.status, decision.state
                else:
                    for index in range(policy.entry_confirmation_minutes // 5 + 1):
                        boundary = cutoff - timedelta(
                            minutes=policy.entry_confirmation_minutes - index * 5
                        )
                        counts = _counts(apps, alias, snapshot, boundary)
                        decision = evaluate(
                            status=status,
                            origin="system",
                            state=state,
                            counts=counts,
                            policy=policy,
                            boundary=boundary,
                            input_revision=saved.get("pending_input_revision", 0),
                        )
                        status, state = decision.status, decision.state
            except ValueError as exc:
                # Query/database failures are not caught: abort/retry the batch.
                status, state, reason = "for_review", {}, str(exc)
            with transaction.atomic(using=alias):
                locked_policy = (
                    PolicyRow.objects.using(alias).select_for_update().get(pk=row.pk)
                )
                if grouping:
                    Scope.objects.using(alias).select_for_update().get(
                        pk=grouping.scope_id
                    )
                    current_grouping = (
                        Grouping.objects.using(alias)
                        .select_for_update()
                        .get(pk=grouping.pk)
                    )
                    if (
                        current_grouping.dirty
                        or current_grouping.retired
                        or current_grouping.membership_revision != membership_revision
                    ):
                        continue
                current = (
                    Issue.objects.using(alias).select_for_update().get(pk=snapshot.pk)
                )
                if (
                    current.status_origin != "system"
                    or current.status_revision != snapshot.status_revision
                    or current.escalation_state != saved
                    or locked_policy.revision != policy.revision
                ):
                    continue
                evidence = {
                    "transition_reason": reason,
                    "window_end": cutoff.isoformat(),
                    "evaluated_at": now.isoformat(),
                    "algorithm_version": ALGORITHM_VERSION,
                    "policy_revision": policy.revision,
                    "effective_settings": policy.values(),
                }
                if counts is not None and state:
                    evidence.update(
                        current_count=counts.current,
                        historical_count=counts.historical,
                        affected_trace_count=counts.affected_traces,
                        unit=counts.unit,
                        baseline=float(decision.baseline),
                        baseline_exact=str(decision.baseline),
                        entry_threshold=float(decision.entry_threshold),
                        recovery_threshold=float(decision.recovery_threshold),
                        window_start=(cutoff - timedelta(hours=1)).isoformat(),
                    )
                    if (
                        snapshot.source == "eval"
                        and snapshot.eval_target_type == "session"
                    ):
                        # Trace breadth requires ClickHouse; never invent zero
                        # during a database-only migration. The runtime replaces
                        # this reason with qualified evidence on its next check.
                        evidence.pop("affected_trace_count", None)
                if current.status != status:
                    current.status_revision += 1
                    current.status_changed_at = now
                    current.status_changed_by_id = None
                current.status = status
                current.escalation_state = {
                    **saved,
                    "progress": state,
                    "reason": evidence,
                    "algorithm_version": ALGORITHM_VERSION,
                    "evaluated_policy_revision": policy.revision,
                    "evaluated_input_revision": saved.get("pending_input_revision", 0),
                    "migration_completed": MIGRATION_ID,
                    "migration_cutoff": cutoff.isoformat(),
                }
                current.escalation_next_evaluation_at = (
                    now + timedelta(minutes=5)
                    if status == "escalating" or state.get("entry_checks")
                    else None
                )
                current.save(
                    using=alias,
                    update_fields=[
                        "status",
                        "status_revision",
                        "status_changed_at",
                        "status_changed_by",
                        "escalation_state",
                        "escalation_next_evaluation_at",
                        "updated_at",
                    ],
                )
                completed += 1
    print(
        f"[{MIGRATION_ID}] initialized={completed} preserved_unknown_ownership={skipped_unknown}"
    )


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("tracer", "0117_feed_escalation_policy")]
    operations = [
        migrations.RunPython(backfill_feed_issue_statuses, migrations.RunPython.noop)
    ]
