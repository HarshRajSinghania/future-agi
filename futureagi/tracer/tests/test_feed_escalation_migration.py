"""Frozen policy parity and the real historical-model RunPython path."""

import importlib
from datetime import timedelta

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from tracer.services.feed_escalation_policy import Counts, Policy, evaluate
from tracer.tests.test_feed_escalation_policy import T


@pytest.mark.unit
@pytest.mark.parametrize(
    "count,history,expected",
    [
        (20, 0, "escalating"),
        (20, 120, "escalating"),
        (19, 0, "for_review"),
        (150, 2400, "for_review"),
    ],
)
def test_migration_policy_matches_independent_expected_cases(count, history, expected):
    frozen = importlib.import_module("tracer.migrations._feed_escalation_v1")
    state = frozen_state = {}
    for minute in (0, 5, 10, 15):
        kwargs = {
            "status": "for_review",
            "origin": "system",
            "boundary": T + timedelta(minutes=minute),
            "input_revision": 1,
        }
        runtime = evaluate(
            **kwargs, state=state, counts=Counts(count, history), policy=Policy()
        )
        result = frozen.evaluate(
            **kwargs,
            state=frozen_state,
            counts=frozen.Counts(count, history),
            policy=frozen.Policy(),
        )
        assert result.status == runtime.status
        assert result.state == runtime.state
        state, frozen_state = runtime.state, result.state
    assert result.status == expected


@pytest.mark.integration
@pytest.mark.django_db(transaction=True)
def test_runpython_preserves_manual_unknown_and_backfills_proven_system(
    observe_project, monkeypatch
):
    import uuid

    from tracer.models.trace_error_analysis import TraceErrorGroup
    from tracer.models.trace_scan import TraceScanIssue, TraceScanResult
    from tracer.tests.test_feed_escalation_inputs import add_scan_finding

    migration = importlib.import_module(
        "tracer.migrations.0118_backfill_feed_issue_statuses"
    )
    monkeypatch.setattr(migration, "migration_now", lambda: T + timedelta(minutes=10))
    cluster = TraceErrorGroup.no_workspace_objects.create(
        project=observe_project,
        cluster_id="MIGRATE-GROWTH",
        error_type="tool",
        status="escalating",
        status_origin="system",
    )
    scan = TraceScanResult.no_workspace_objects.create(
        project=observe_project,
        trace_id=uuid.uuid4(),
        status="completed",
        has_issues=True,
    )
    for _ in range(20):
        add_scan_finding(cluster, scan, T - timedelta(minutes=25))
    # Independent historical fixture: these findings were already published
    # before the first replayed confirmation, not inserted as final statuses.
    TraceScanIssue.no_workspace_objects.filter(cluster=cluster).update(
        created_at=T - timedelta(hours=2)
    )
    manual = TraceErrorGroup.no_workspace_objects.create(
        project=observe_project,
        cluster_id="MIGRATE-MANUAL",
        error_type="tool",
        status="for_review",
        status_origin="manual",
    )
    unknown = TraceErrorGroup.no_workspace_objects.create(
        project=observe_project,
        cluster_id="MIGRATE-UNKNOWN",
        error_type="tool",
        status="escalating",
        status_origin="legacy_unknown",
    )
    below = TraceErrorGroup.no_workspace_objects.create(
        project=observe_project,
        cluster_id="MIGRATE-BELOW",
        error_type="tool",
        status="escalating",
        status_origin="system",
    )
    executor = MigrationExecutor(connection)
    executor.migrate([("tracer", "0117_feed_escalation_policy")])
    try:
        executor = MigrationExecutor(connection)
        executor.migrate([("tracer", "0118_backfill_feed_issue_statuses")])
        for issue in (cluster, manual, unknown, below):
            issue.refresh_from_db()
        assert cluster.status == "escalating"
        assert cluster.escalation_state["migration_completed"] == migration.MIGRATION_ID
        assert cluster.escalation_state["reason"]["current_count"] == 20
        assert below.status == "for_review"
        assert manual.status == "for_review" and manual.status_origin == "manual"
        assert (
            unknown.status == "escalating" and unknown.status_origin == "legacy_unknown"
        )
        before = cluster.status_revision, cluster.escalation_state
        apps = executor.loader.project_state(
            [("tracer", "0118_backfill_feed_issue_statuses")]
        ).apps
        with connection.schema_editor(atomic=False) as editor:
            migration.backfill_feed_issue_statuses(apps, editor)
        cluster.refresh_from_db()
        assert (cluster.status_revision, cluster.escalation_state) == before
    finally:
        MigrationExecutor(connection).migrate(
            [("tracer", "0118_backfill_feed_issue_statuses")]
        )


@pytest.mark.integration
@pytest.mark.django_db
def test_old_writer_can_insert_after_additive_schema_without_claiming_system_ownership(
    observe_project,
):
    import uuid

    from tracer.models.trace_error_analysis import ErrorClusterTraces, TraceErrorGroup
    from tracer.models.trace_scan import TraceScanIssue, TraceScanResult

    executor = MigrationExecutor(connection)
    old_apps = executor.loader.project_state(
        [("tracer", "0110_expand_investigation_requirement_id")]
    ).apps
    old_issue = old_apps.get_model("tracer", "TraceErrorGroup").objects.create(
        project_id=observe_project.pk,
        cluster_id="OLD-WRITER",
        error_type="tool",
    )
    current = TraceErrorGroup.no_workspace_objects.get(pk=old_issue.pk)
    assert current.status_origin == "legacy_unknown"
    assert current.status_revision == 0
    assert current.escalation_state == {}
    scan = TraceScanResult.no_workspace_objects.create(
        project=observe_project, trace_id=uuid.uuid4(), status="completed"
    )
    old_finding = old_apps.get_model("tracer", "TraceScanIssue").objects.create(
        scan_result_id=scan.pk,
        cluster_id=old_issue.pk,
        category="tool",
        group="Tools",
        fix_layer="Tools",
        brief="Legacy writer",
    )
    old_member = old_apps.get_model("tracer", "ErrorClusterTraces").objects.create(
        cluster_id=old_issue.pk,
        trace_id=scan.trace_id,
        scan_issue_id=old_finding.pk,
    )
    assert (
        TraceScanIssue.no_workspace_objects.get(
            pk=old_finding.pk
        ).occurrence_time_source
        == ""
    )
    assert (
        ErrorClusterTraces.no_workspace_objects.get(
            pk=old_member.pk
        ).occurrence_time_source
        == ""
    )


@pytest.mark.integration
@pytest.mark.django_db
def test_migration_ignores_a_failure_superseded_by_a_passing_eval(custom_eval_config):
    import uuid

    from django.apps import apps

    from tracer.models.observation_span import EvalLogger
    from tracer.models.trace_error_analysis import ErrorClusterTraces, TraceErrorGroup

    migration = importlib.import_module(
        "tracer.migrations.0118_backfill_feed_issue_statuses"
    )
    issue = TraceErrorGroup.no_workspace_objects.create(
        project=custom_eval_config.project,
        source="eval",
        eval_target_type="span",
        eval_config=custom_eval_config,
        cluster_id="MIGRATE-PASS",
        error_type="quality",
    )
    shape = {"trace_id": uuid.uuid4(), "observation_span_id": "repaired-span"}
    failed = EvalLogger.no_workspace_objects.create(
        custom_eval_config=custom_eval_config,
        target_type="span",
        **shape,
        output_bool=False,
        config_hash="a" * 64,
        eval_task_id="failed",
    )
    member = ErrorClusterTraces.no_workspace_objects.create(
        cluster=issue,
        eval_logger=failed,
        trace_id=shape["trace_id"],
        occurred_at=T - timedelta(minutes=20),
        occurrence_time_source="span_end",
    )
    ErrorClusterTraces.no_workspace_objects.filter(pk=member.pk).update(
        created_at=T - timedelta(hours=1)
    )
    EvalLogger.no_workspace_objects.create(
        custom_eval_config=custom_eval_config,
        target_type="span",
        **shape,
        output_bool=True,
        config_hash="a" * 64,
        eval_task_id="passed",
    )
    assert migration._counts(apps, connection.alias, issue, T).current == 0
