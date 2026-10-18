"""Instant eval at scale: server-side populations, hash-ordered samples, the
limits, and the summary, rows and export endpoints aggregating in SQL."""

import csv
import hashlib
import io
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from django.test import override_settings
from rest_framework import status

from tracer.models.custom_eval_config import CustomEvalConfig
from tracer.models.eval_task import EvalTask, EvalTaskStatus, RowType, RunType
from tracer.models.instant_eval import InstantEvalRow, InstantEvalRun
from tracer.models.observation_span import EvalEntryStatus, EvalLogger, EvalTargetType
from tracer.selectors.eval_tasks.row_resolver import resolve_desired_rows
from tracer.services import instant_eval_rows as rows_service
from tracer.services import instant_eval_summary as summary_service
from tracer.services.instant_eval_answers import record_answer
from tracer.views import instant_eval_scale

ESTIMATE = "/tracer/instant-eval/estimate/"
START = "/tracer/instant-eval/start/"
SUMMARY = "/tracer/instant-eval/summary/"
ROWS = "/tracer/instant-eval/rows/"
EXPORT = "/tracer/instant-eval/export/"
CONTROL = "/tracer/instant-eval/control/"
WINDOW = [
    {
        "column_id": "created_at",
        "filter_config": {
            "filter_type": "datetime",
            "filter_op": "between",
            "filter_value": ["2026-10-01T00:00:00Z", "2026-10-15T00:00:00Z"],
        },
    }
]


def _hash(row_id: str) -> int:
    # Any stable 64-bit hash stands in for ClickHouse's cityHash64.
    return int.from_bytes(hashlib.sha256(row_id.encode()).digest()[:8], "big")


class FakeView:
    """A view of ``n`` sessions, read the way ClickHouse would: in hash order,
    after a cursor."""

    def __init__(self, n, *, start=datetime(2026, 10, 2, tzinfo=UTC)):
        self.ids = [str(uuid.UUID(int=i + 1)) for i in range(n)]
        self.start = start
        self.picks = []

    def count(self, project_id, unit, filters):
        return rows_service.Population(
            len(self.ids), False, self.start, self.start + timedelta(days=13), filters
        )

    def pick(self, project_id, unit, filters, *, n, after):
        self.picks.append((n, after))
        ordered = sorted(((i, _hash(i)) for i in self.ids), key=lambda x: (x[1], x[0]))
        if after is not None:
            ordered = [x for x in ordered if x[1] > after]
        return ordered[:n]

    def facets(self, project_id, row_type, ids, *, start=None, end=None):
        out = {}
        for i in ids:
            k = int(uuid.UUID(i))
            out[i] = {
                "time": self.start + timedelta(hours=k),
                "end_user_id": str(uuid.UUID(int=1000 + k % 3)),
                "user_label": f"cust_{k % 3}",
                "model": "gpt-4.1-mini" if k % 2 else "gpt-4.1",
                "turns": k % 8 or None,
                "duration_ms": 1000 * k,
                "error": k % 5 == 0,
                "excerpt": f"message {k}",
                "trace_id": None,
            }
        return out


@pytest.fixture
def fake_view(monkeypatch):
    view = FakeView(40)
    monkeypatch.setattr(rows_service, "count_population", view.count)
    monkeypatch.setattr(rows_service, "pick_rows", view.pick)
    monkeypatch.setattr(rows_service, "read_facets", view.facets)
    return view


@pytest.fixture
def started(monkeypatch):
    calls = []
    monkeypatch.setattr(
        "tfc.temporal.eval_tasks.client.start_eval_task_workflow_sync",
        lambda task, **kw: calls.append((str(task.id), kw)) or "wf",
    )
    monkeypatch.setattr(
        "tfc.temporal.eval_tasks.client.signal_pause_eval_task_workflow",
        lambda task_id: True,
    )
    # Tests run inside one transaction, so nothing ever commits.
    monkeypatch.setattr(
        instant_eval_scale.transaction, "on_commit", lambda fn, *a, **k: fn()
    )
    return calls


def _question(project, template, text, answer_type="yes_no", labels=None):
    labels = labels or (["Yes", "No"] if answer_type == "yes_no" else [])
    return CustomEvalConfig.objects.create(
        name=text,
        project=project,
        eval_template=template,
        config={
            "instant_eval": {
                "question": text,
                "answer_type": answer_type,
                "labels": labels,
                "reads": "transcript",
                "unit": "sessions",
            }
        },
        mapping={"transcript": "transcript"},
        filters={},
    )


@pytest.fixture
def yes_no(observe_project, eval_template):
    return _question(observe_project, eval_template, "Did the agent resolve it?")


@pytest.fixture
def category(observe_project, eval_template):
    return _question(
        observe_project,
        eval_template,
        "What did the customer come for?",
        "category",
        ["Order status", "Return or refund", "Something else"],
    )


def _start(auth_client, project, configs, **body):
    return auth_client.post(
        START,
        {
            "project_id": str(project.id),
            "unit": "sessions",
            "filters": WINDOW,
            "config_ids": [str(c.id) for c in configs],
            **body,
        },
        format="json",
    )


def _answer(
    task, config, session_id, label=None, *, error=False, confidence=0.9, pending=False
):
    return EvalLogger(
        target_type=EvalTargetType.SESSION,
        trace_session_id=session_id,
        eval_task_id=str(task.id),
        custom_eval_config=config,
        output_str_list=[label] if label else [],
        error=error,
        status=(
            EvalEntryStatus.PENDING
            if pending
            else EvalEntryStatus.ERRORED
            if error
            else EvalEntryStatus.COMPLETED
        ),
        output_metadata={"jev": {"confidence": confidence}},
        eval_explanation=f"because {label}",
    )


# ─── Sample, limits, concurrency ─────────────────────────────────────────────
@pytest.mark.django_db
def test_estimate_offers_a_sample_and_the_whole_view(
    auth_client, observe_project, monkeypatch
):
    view = FakeView(104_233)
    monkeypatch.setattr(rows_service, "count_population", view.count)
    result = auth_client.post(
        ESTIMATE,
        {
            "project_id": str(observe_project.id),
            "unit": "sessions",
            "filters": WINDOW,
            "sample_size": 1000,
            "questions": 2,
        },
        format="json",
    ).json()["result"]
    assert result["population"] == 104_233
    assert result["rows_to_read"] == 1000
    assert result["credits_estimate"] == pytest.approx(1000 * 2 * 0.06)
    assert result["default_sample_size"] == 1000
    every = result["choices"][-1]
    assert every["sample_size"] is None and every["rows_to_read"] == 104_233
    assert every["needs_confirm"] is True and every["allowed"] is False
    assert [c["sample_size"] for c in result["choices"][:-1]] == [500, 1000, 2000, 5000]


@pytest.mark.django_db
def test_a_sample_reads_the_same_rows_every_time_and_extends_with_the_next(
    auth_client, observe_project, yes_no, fake_view, started
):
    first = _start(auth_client, observe_project, [yes_no], sample_size=10).json()[
        "result"
    ]
    again = _start(auth_client, observe_project, [yes_no], sample_size=10).json()[
        "result"
    ]
    tasks = [EvalTask.objects.get(id=r["task_id"]) for r in (first, again)]
    rows = [resolve_desired_rows(t).matched_ids for t in tasks]
    assert len(rows[0]) == 10 and rows[0] == rows[1]
    by_hash = sorted(fake_view.ids, key=lambda i: (_hash(i), i))
    assert list(rows[0]) == by_hash[:10]
    # Resolving again (a resume) picks nothing new.
    assert resolve_desired_rows(tasks[0]).matched_ids == rows[0]

    EvalTask.objects.filter(id=tasks[0].id).update(status=EvalTaskStatus.COMPLETED)
    more = auth_client.post(
        CONTROL,
        {
            "project_id": str(observe_project.id),
            "eval_task_id": first["task_id"],
            "action": "read_more",
            "more": 5,
        },
        format="json",
    )
    assert more.status_code == status.HTTP_200_OK, more.json()
    extended = resolve_desired_rows(EvalTask.objects.get(id=tasks[0].id)).matched_ids
    assert list(extended) == by_hash[:15]
    assert fake_view.picks[-1] == (5, _hash(by_hash[9]))
    ranks = list(
        InstantEvalRow.objects.filter(task_id=tasks[0].id)
        .order_by("sample_rank")
        .values_list("sample_rank", flat=True)
    )
    assert ranks == list(range(15))


@pytest.mark.django_db
@override_settings(INSTANT_EVAL_CONFIRM_ROWS=20, INSTANT_EVAL_MAX_ROWS=30)
def test_big_runs_need_a_confirm_and_runs_over_the_cap_are_refused(
    auth_client, observe_project, yes_no, fake_view, started
):
    refused = _start(auth_client, observe_project, [yes_no], sample_size=None)
    assert refused.status_code == status.HTTP_400_BAD_REQUEST
    assert "at most 30 rows" in refused.json()["message"]

    asked = _start(auth_client, observe_project, [yes_no], sample_size=25)
    assert asked.status_code == status.HTTP_409_CONFLICT
    body = asked.json()
    assert body["result"]["error_code"] == "INSTANT_EVAL_CONFIRM"
    assert body["result"]["rows_to_read"] == 25
    assert not EvalTask.objects.filter(project=observe_project).exists()

    confirmed = _start(
        auth_client, observe_project, [yes_no], sample_size=25, confirm=True
    )
    assert confirmed.status_code == status.HTTP_200_OK
    run = InstantEvalRun.objects.get(eval_task_id=confirmed.json()["result"]["task_id"])
    assert run.rows_requested == 25 and run.population == 40
    assert run.credits_estimate == pytest.approx(25 * 0.06)
    assert run.created_by is not None
    assert len(started) == 1


@pytest.mark.django_db
@override_settings(INSTANT_EVAL_MAX_ACTIVE_PER_ORG=2)
def test_an_organization_runs_at_most_two_at_once(
    auth_client, observe_project, yes_no, fake_view, started
):
    for _ in range(2):
        assert (
            _start(auth_client, observe_project, [yes_no], sample_size=5).status_code
            == 200
        )
    third = _start(auth_client, observe_project, [yes_no], sample_size=5)
    assert third.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    body = third.json()["result"]
    assert body["error_code"] == "INSTANT_EVAL_BUSY"
    assert len(body["runs"]) == 2
    assert "Did the agent resolve it?" in body["message"]
    # A paused run no longer counts.
    EvalTask.objects.filter(id=body["runs"][0]["task_id"]).update(
        status=EvalTaskStatus.PAUSED
    )
    assert (
        _start(auth_client, observe_project, [yes_no], sample_size=5).status_code == 200
    )


@pytest.mark.django_db
def test_handed_over_ids_are_read_whole_and_capped(
    auth_client, observe_project, yes_no, fake_view, started
):
    ids = fake_view.ids[:7]
    response = _start(auth_client, observe_project, [yes_no], ids=ids, sample_size=3)
    result = response.json()["result"]
    assert result["rows_requested"] == 7 and result["is_sample"] is False
    task = EvalTask.objects.get(id=result["task_id"])
    assert sorted(resolve_desired_rows(task).matched_ids) == sorted(ids)
    too_many = _start(
        auth_client,
        observe_project,
        [yes_no],
        ids=[str(uuid.uuid4()) for _ in range(5001)],
    )
    assert too_many.status_code == status.HTTP_400_BAD_REQUEST


# ─── Summary, rows, export ───────────────────────────────────────────────────
@pytest.fixture
def answered_run(auth_client, observe_project, yes_no, category, fake_view, started):
    """A finished run over 12 sessions with two questions and known answers."""
    result = _start(
        auth_client, observe_project, [yes_no, category], sample_size=12
    ).json()["result"]
    task = EvalTask.objects.get(id=result["task_id"])
    ids = list(resolve_desired_rows(task).matched_ids)
    logs = []
    for n, sid in enumerate(ids):
        k = int(uuid.UUID(sid))
        if n == 0:
            logs.append(_answer(task, yes_no, sid, error=True))
        else:
            logs.append(
                _answer(
                    task,
                    yes_no,
                    sid,
                    "No" if k % 2 else "Yes",
                    confidence=0.4 if n == 1 else 0.9,
                )
            )
        logs.append(
            _answer(
                task,
                category,
                sid,
                ["Order status", "Return or refund", "Something else"][k % 3],
            )
        )
    EvalLogger.objects.bulk_create(logs)
    # Each answer is copied over as it lands (entries.mark_terminal).
    for entry in logs:
        record_answer(entry.id)
    EvalTask.objects.filter(id=task.id).update(status=EvalTaskStatus.COMPLETED)
    return task, ids


def _summary(auth_client, project, task, tz="UTC"):
    response = auth_client.get(
        SUMMARY, {"project_id": str(project.id), "eval_task_id": str(task.id), "tz": tz}
    )
    assert response.status_code == 200, response.content
    return response.json()["result"]


@pytest.mark.django_db
def test_summary_counts_match_the_answers(
    auth_client, observe_project, yes_no, category, answered_run
):
    task, ids = answered_run
    s = _summary(auth_client, observe_project, task)
    keys = [int(uuid.UUID(i)) for i in ids]
    yes = sum(1 for k in keys[1:] if k % 2 == 0)
    assert s["status"] == "completed"
    assert (s["total"], s["answered"], s["failed"], s["pending"]) == (12, 11, 1, 0)
    assert s["counts"][str(yes_no.id)] == {"Yes": yes, "No": 11 - yes, "__error__": 1}
    assert sum(s["counts"][str(category.id)].values()) == 12
    assert sum(s["unsure"][str(yes_no.id)].values()) == 1
    assert s["sample"] == {
        "population": 40,
        "population_is_lower_bound": False,
        "requested": 12,
        "read": 12,
        "is_sample": True,
        "can_extend": True,
        "next_size": 12,
    }
    assert [q["answer_type"] for q in s["questions"]] == ["yes_no", "category"]
    # Every row lands in exactly one timeline bin and one model group.
    assert sum(b["n"] for b in s["timeline"]["bins"]) == 12
    assert len(s["timeline"]["bins"]) <= 120
    assert sum(g["n"] for g in s["groups"]["model"]) == 12
    assert sum(g["n"] for g in s["groups"]["day_hour"]) == 12
    models = {g["key"]: g for g in s["groups"]["model"]}
    assert models["gpt-4.1"]["counts"][str(yes_no.id)].get("Yes", 0) + models[
        "gpt-4.1"
    ]["counts"][str(yes_no.id)].get("__error__", 0) == sum(
        1 for k in keys if k % 2 == 0
    )
    assert {g["key"] for g in s["groups"]["error"]} <= {"error", "ok"}
    errors = sum(1 for k in keys if k % 5 == 0)
    assert sum(b["errors"] for b in s["timeline"]["bins"]) == errors
    # Cross-question counts both ways, answered rows only.
    cross = s["cross"][str(category.id)][str(yes_no.id)]
    assert sum(n for by in cross.values() for n in by.values()) == 11
    assert s["cross"][str(yes_no.id)][str(category.id)]


@pytest.mark.django_db
def test_days_split_at_the_viewers_midnight(
    auth_client, observe_project, yes_no, answered_run
):
    task, ids = answered_run
    # 06:30 and 07:30 UTC on Oct 13 straddle midnight in Los Angeles (UTC-7).
    InstantEvalRow.objects.filter(task_id=task.id).update(
        time=datetime(2026, 10, 13, 7, 30, tzinfo=UTC)
    )
    InstantEvalRow.objects.filter(task_id=task.id, row_id=ids[0]).update(
        time=datetime(2026, 10, 13, 6, 30, tzinfo=UTC)
    )
    utc = {
        g["key"]: g["n"]
        for g in _summary(auth_client, observe_project, task)["groups"]["day"]
    }
    la = {
        g["key"]: g["n"]
        for g in _summary(auth_client, observe_project, task, "America/Los_Angeles")[
            "groups"
        ]["day"]
    }
    assert utc == {"2026-10-13": 12}
    assert la == {"2026-10-12": 1, "2026-10-13": 11}
    la_hours = _summary(auth_client, observe_project, task, "America/Los_Angeles")[
        "groups"
    ]["day_hour"]
    assert {g["key"] for g in la_hours} == {"2026-10-12|23", "2026-10-13|00"}
    # A selected local day reads exactly its rows.
    page = auth_client.get(
        ROWS,
        {
            "project_id": str(observe_project.id),
            "eval_task_id": str(task.id),
            "tz": "America/Los_Angeles",
            "group": "day:2026-10-12",
        },
    ).json()["result"]
    assert [r["id"] for r in page["rows"]] == [ids[0]]


@pytest.mark.django_db
def test_rows_page_through_every_row_and_filter_like_the_charts(
    auth_client, observe_project, yes_no, category, answered_run
):
    task, ids = answered_run
    base = {
        "project_id": str(observe_project.id),
        "eval_task_id": str(task.id),
        "tz": "UTC",
    }
    seen, cursor = [], None
    while True:
        page = auth_client.get(
            ROWS, {**base, "page_size": 5, **({"cursor": cursor} if cursor else {})}
        ).json()["result"]
        assert page["total"] == 12
        seen += page["rows"]
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert sorted(r["id"] for r in seen) == sorted(ids)
    times = [r["time"] for r in seen]
    assert times == sorted(times, reverse=True)
    assert seen[0]["answers"][str(category.id)]["answer"] in (
        "Order status",
        "Return or refund",
        "Something else",
    )

    keys = {i: int(uuid.UUID(i)) for i in ids}
    no = auth_client.get(
        ROWS, {**base, "config_id": str(yes_no.id), "answer": "No"}
    ).json()["result"]
    assert {r["id"] for r in no["rows"]} == {i for i in ids[1:] if keys[i] % 2}
    failed = auth_client.get(
        ROWS, {**base, "config_id": str(yes_no.id), "answer": "__error__"}
    ).json()["result"]
    assert [r["id"] for r in failed["rows"]] == [ids[0]]
    unsure = auth_client.get(ROWS, {**base, "unsure": "true"}).json()["result"]
    assert [r["id"] for r in unsure["rows"]] == [ids[1]]
    model = auth_client.get(ROWS, {**base, "group": "model:gpt-4.1-mini"}).json()[
        "result"
    ]
    assert {r["id"] for r in model["rows"]} == {i for i in ids if keys[i] % 2}
    either = auth_client.get(
        ROWS, {**base, "group": "model:gpt-4.1-mini,model:gpt-4.1"}
    ).json()["result"]
    assert either["total"] == 12
    both = auth_client.get(
        ROWS,
        {
            **base,
            "answers": f'[{{"config_id": "{yes_no.id}", "answer": "No"}}, {{"config_id": "{category.id}", "answer": "Order status"}}]',
        },
    ).json()["result"]
    assert {r["id"] for r in both["rows"]} == {
        i for i in ids[1:] if keys[i] % 2 and keys[i] % 3 == 0
    }
    first = min(r["time"] for r in seen)
    window = auth_client.get(
        ROWS, {**base, "time_from": first, "time_to": first[:19] + ".000001+00:00"}
    ).json()["result"]
    assert window["total"] == 1
    by_confidence = auth_client.get(
        ROWS,
        {**base, "sort": "confidence", "config_id": str(yes_no.id), "page_size": 1},
    ).json()["result"]
    assert by_confidence["rows"][0]["id"] == ids[1]
    bad = auth_client.get(ROWS, {**base, "group": "planet:mars"})
    assert bad.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_export_streams_every_selected_row(
    auth_client, observe_project, yes_no, category, answered_run
):
    task, ids = answered_run
    response = auth_client.get(
        EXPORT, {"project_id": str(observe_project.id), "eval_task_id": str(task.id)}
    )
    assert response.status_code == 200
    body = b"".join(response.streaming_content).decode()
    lines = list(csv.reader(io.StringIO(body)))
    assert len(lines) == 13
    assert lines[0][-3:] == [
        "What did the customer come for? · answer",
        "What did the customer come for? · confidence",
        "What did the customer come for? · explanation",
    ]
    assert sorted(line[0] for line in lines[1:]) == sorted(ids)
    filtered = auth_client.get(
        EXPORT,
        {
            "project_id": str(observe_project.id),
            "eval_task_id": str(task.id),
            "config_id": str(yes_no.id),
            "answer": "__error__",
        },
    )
    assert (
        len(
            list(csv.reader(io.StringIO(b"".join(filtered.streaming_content).decode())))
        )
        == 2
    )


@pytest.mark.django_db
def test_summary_of_another_organizations_run_is_not_found(auth_client, answered_run):
    from accounts.models.organization import Organization
    from model_hub.models.ai_model import AIModel
    from tracer.models.project import Project

    task, _ = answered_run
    other = Organization.objects.create(name="Elsewhere")
    project = getattr(Project, "no_workspace_objects", Project.objects).create(
        name="Elsewhere",
        organization=other,
        model_type=AIModel.ModelTypes.GENERATIVE_LLM,
        trace_type="observe",
    )
    response = auth_client.get(
        SUMMARY, {"project_id": str(project.id), "eval_task_id": str(task.id)}
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND


# ─── Control ─────────────────────────────────────────────────────────────────
@pytest.mark.django_db
def test_retry_failed_requeues_only_the_failures(
    auth_client, observe_project, yes_no, answered_run, started
):
    task, ids = answered_run
    response = auth_client.post(
        CONTROL,
        {
            "project_id": str(observe_project.id),
            "eval_task_id": str(task.id),
            "action": "retry_failed",
        },
        format="json",
    )
    assert response.status_code == 200, response.json()
    assert response.json()["result"]["retried"] == 1
    entry = EvalLogger.objects.get(
        eval_task_id=str(task.id), trace_session_id=ids[0], custom_eval_config=yes_no
    )
    assert entry.status == EvalEntryStatus.PENDING and entry.error is False
    assert EvalTask.objects.get(id=task.id).status == EvalTaskStatus.PENDING
    assert started[-1][1] == {"replace_existing": True}


@pytest.mark.django_db
def test_cancel_stops_a_run_and_its_unread_rows_are_not_read(
    auth_client, observe_project, yes_no, fake_view, started
):
    result = _start(auth_client, observe_project, [yes_no], sample_size=6).json()[
        "result"
    ]
    task = EvalTask.objects.get(id=result["task_id"])
    ids = list(resolve_desired_rows(task).matched_ids)
    logs = EvalLogger.objects.bulk_create(
        [_answer(task, yes_no, ids[0], "Yes")]
        + [_answer(task, yes_no, i, pending=True) for i in ids[1:]]
    )
    for entry in logs:
        record_answer(entry.id)
    EvalTask.objects.filter(id=task.id).update(status=EvalTaskStatus.RUNNING)
    running = _summary(auth_client, observe_project, task)
    assert (running["status"], running["pending"], running["answered"]) == (
        "running",
        5,
        1,
    )
    more = auth_client.post(
        CONTROL,
        {
            "project_id": str(observe_project.id),
            "eval_task_id": str(task.id),
            "action": "read_more",
            "more": 5,
        },
        format="json",
    )
    assert more.status_code == status.HTTP_409_CONFLICT
    cancel = auth_client.post(
        CONTROL,
        {
            "project_id": str(observe_project.id),
            "eval_task_id": str(task.id),
            "action": "cancel",
        },
        format="json",
    )
    assert cancel.json()["result"]["status"] == "cancelled"
    done = _summary(auth_client, observe_project, task)
    assert (done["status"], done["pending"], done["not_read"]) == ("cancelled", 0, 5)
    assert done["sample"]["can_extend"] is False


def test_hash_sample_sql_orders_by_hash_and_continues_after_the_cursor(monkeypatch):
    seen = {}

    class Builder:
        def build_id_query(self):
            return "SELECT session_id FROM spans WHERE x = %(x)s", {"x": 1}

    monkeypatch.setattr(rows_service, "_builder", lambda *a: (Builder(), "session_id"))
    monkeypatch.setattr(
        rows_service,
        "_ch",
        lambda sql, params: seen.update(sql=sql, params=params) or [],
    )
    rows_service.pick_rows("p", "sessions", [], n=1000, after=42)
    assert "cityHash64(toString(session_id))" in seen["sql"]
    assert "WHERE h > %(ie_after)s ORDER BY h, rid LIMIT %(ie_n)s" in seen["sql"]
    assert seen["params"] == {"x": 1, "ie_n": 1000, "ie_after": 42}


def test_excerpts_find_the_user_message_in_cut_off_chat_json():
    raw = '[{"role": "system", "content": "You are Harbor"}, {"role": "user", "content": "Where is order #4471?"}, {"role": "assistant", "content": "Let me ch'
    assert rows_service.excerpt_of(raw) == "Where is order #4471?"
    assert rows_service.excerpt_of("plain text") == "plain text"


def test_bins_pick_the_smallest_size_that_fits():
    assert summary_service.pick_bin(60 * 60_000) == 60_000
    assert summary_service.pick_bin(29 * 24 * 3_600_000) == 6 * 3_600_000
    # One bin is kept for the first, aligned to a local boundary before the window.
    assert summary_service.pick_bin(30 * 24 * 3_600_000) == 12 * 3_600_000
    assert summary_service._hour_range(9, 12) == "9 AM–12 PM"
    assert summary_service._hour_range(6, 9) == "6–9 AM"
    assert summary_service._hour_range(21, 24) == "9 PM–12 AM"


@pytest.mark.django_db
def test_instant_sizing_applies_at_any_size(observe_project, yes_no):
    from tfc.temporal.eval_tasks.client import _instant_sizing

    task = EvalTask.objects.create(
        project=observe_project,
        name="Instant eval · big",
        filters={},
        sampling_rate=100,
        spans_limit=100_000,
        run_type=RunType.HISTORICAL,
        status=EvalTaskStatus.PENDING,
        row_type=RowType.SESSIONS,
    )
    task.evals.add(yes_no)
    assert _instant_sizing(task) == {
        "batch_size": 200,
        "max_concurrent": 32,
        "heartbeat_s": 60,
    }


# ─── Answers as they land, stalled runs, model by day ────────────────────────
@pytest.mark.django_db
def test_an_answer_lands_in_the_answer_table_when_its_entry_finishes(
    auth_client, observe_project, yes_no, fake_view, started
):
    from tracer.models.instant_eval import InstantEvalAnswer
    from tracer.services.eval_tasks.entries import mark_terminal

    result = _start(auth_client, observe_project, [yes_no], sample_size=2).json()[
        "result"
    ]
    task = EvalTask.objects.get(id=result["task_id"])
    ids = list(resolve_desired_rows(task).matched_ids)
    entry = _answer(task, yes_no, ids[0], "No", confidence=0.3)
    entry.status = EvalEntryStatus.RUNNING
    EvalLogger.objects.bulk_create([entry])
    assert not InstantEvalAnswer.objects.filter(task_id=task.id).exists()
    assert mark_terminal(entry, EvalEntryStatus.COMPLETED, config_hash="h", epoch=None)
    answer = InstantEvalAnswer.objects.get(task_id=task.id)
    assert (answer.label, answer.confidence, answer.config_id) == ("No", 0.3, yes_no.id)
    assert answer.row.row_id == ids[0] and answer.time == answer.row.time


def _running_with_unanswered(auth_client, observe_project, yes_no):
    result = _start(auth_client, observe_project, [yes_no], sample_size=4).json()[
        "result"
    ]
    task = EvalTask.objects.get(id=result["task_id"])
    ids = list(resolve_desired_rows(task).matched_ids)
    logs = EvalLogger.objects.bulk_create(
        [_answer(task, yes_no, ids[0], "Yes")]
        + [_answer(task, yes_no, i, pending=True) for i in ids[1:]]
    )
    for entry in logs:
        record_answer(entry.id)
    long_ago = datetime.now(UTC) - timedelta(minutes=10)
    from tracer.models.instant_eval import InstantEvalAnswer

    InstantEvalAnswer.objects.filter(task_id=task.id).update(answered_at=long_ago)
    EvalTask.objects.filter(id=task.id).update(
        status=EvalTaskStatus.RUNNING, updated_at=long_ago
    )
    return task


@pytest.mark.django_db
def test_a_run_whose_workflow_vanished_reports_stalled_and_resumes(
    auth_client, observe_project, yes_no, fake_view, started, monkeypatch
):
    from django.core.cache import cache

    cache.clear()
    task = _running_with_unanswered(auth_client, observe_project, yes_no)
    monkeypatch.setattr(
        "tfc.temporal.eval_tasks.client.describe_eval_task_workflow_sync",
        lambda task_id: "absent",
    )
    stalled = _summary(auth_client, observe_project, task)
    assert (stalled["status"], stalled["answered"], stalled["pending"]) == (
        "stalled",
        1,
        3,
    )
    resumed = auth_client.post(
        CONTROL,
        {
            "project_id": str(observe_project.id),
            "eval_task_id": str(task.id),
            "action": "resume",
        },
        format="json",
    )
    assert resumed.status_code == 200, resumed.json()
    assert started[-1] == (str(task.id), {"replace_existing": True})
    assert EvalTask.objects.get(id=task.id).status == EvalTaskStatus.PENDING


@pytest.mark.django_db
def test_a_quiet_run_with_its_workflow_alive_stays_running(
    auth_client, observe_project, yes_no, fake_view, started, monkeypatch
):
    from django.core.cache import cache

    cache.clear()
    task = _running_with_unanswered(auth_client, observe_project, yes_no)
    monkeypatch.setattr(
        "tfc.temporal.eval_tasks.client.describe_eval_task_workflow_sync",
        lambda task_id: "progressing",
    )
    assert _summary(auth_client, observe_project, task)["status"] == "running"
    refused = auth_client.post(
        CONTROL,
        {
            "project_id": str(observe_project.id),
            "eval_task_id": str(task.id),
            "action": "resume",
        },
        format="json",
    )
    assert refused.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_a_finished_task_with_unanswered_rows_is_stalled(
    auth_client, observe_project, yes_no, fake_view, started
):
    task = _running_with_unanswered(auth_client, observe_project, yes_no)
    EvalLogger.objects.filter(
        eval_task_id=str(task.id), status=EvalEntryStatus.PENDING
    ).update(deleted=True)
    EvalTask.objects.filter(id=task.id).update(status=EvalTaskStatus.COMPLETED)
    summary = _summary(auth_client, observe_project, task)
    assert (summary["status"], summary["pending"]) == ("stalled", 3)


@pytest.mark.django_db
def test_entries_the_reaper_gives_up_on_show_as_failed_while_the_run_runs(
    auth_client, observe_project, yes_no, fake_view, started
):
    from tracer.services.eval_tasks.reaper import reap_stale_running

    task = _running_with_unanswered(auth_client, observe_project, yes_no)
    stuck = EvalLogger.objects.filter(
        eval_task_id=str(task.id), status=EvalEntryStatus.PENDING
    )
    gave_up, retried = list(stuck.values_list("id", flat=True))[:2], None
    long_ago = datetime.now(UTC) - timedelta(hours=3)
    EvalLogger.objects.filter(id__in=gave_up).update(
        status=EvalEntryStatus.RUNNING, attempts=3, updated_at=long_ago
    )
    retried = stuck.exclude(id__in=gave_up).values_list("id", flat=True)[0]
    EvalLogger.objects.filter(id=retried).update(
        status=EvalEntryStatus.RUNNING, attempts=0, updated_at=long_ago
    )
    assert reap_stale_running(task, older_than_seconds=60, max_attempts=3) == (1, 2)
    summary = _summary(auth_client, observe_project, task)
    # Two given up on (failed), one requeued (still waiting), one answered.
    assert (
        summary["status"],
        summary["answered"],
        summary["failed"],
        summary["pending"],
    ) == (
        "running",
        1,
        2,
        1,
    )
    assert summary["counts"][str(yes_no.id)]["__error__"] == 2


@pytest.mark.django_db
def test_each_answer_lists_the_users_who_get_it_most_beyond_the_run(
    auth_client, observe_project, yes_no, category, answered_run
):
    import math

    task, ids = answered_run
    # Worked out from the fixture: each session's user and yes/no answer.
    rows: dict[str, list] = {}
    for n, sid in enumerate(ids):
        k = int(uuid.UUID(sid))
        user = str(uuid.UUID(int=1000 + k % 3))
        rows.setdefault(user, []).append(None if n == 0 else "No" if k % 2 else "Yes")

    answered = [x for a in rows.values() for x in a if x]

    def z_score(hits, n_answered, label):
        p0 = answered.count(label) / len(answered)
        return (hits - n_answered * p0) / math.sqrt(n_answered * p0 * (1 - p0))

    expected = {}
    for label in ("Yes", "No"):
        scored = [
            (z_score(a.count(label), len([x for x in a if x]), label), len(a), user)
            for user, a in rows.items()
            if len(a) >= 3 and a.count(label)
        ]
        expected[label] = [
            u for _, _, u in sorted(scored, key=lambda x: (-x[0], -x[1], x[2]))
        ]

    by_answer = _summary(auth_client, observe_project, task)["groups"]["user_by_answer"]
    yes_no_users = by_answer[str(yes_no.id)]
    assert set(yes_no_users) == {label for label in expected if expected[label]}
    for label, users in expected.items():
        got = yes_no_users.get(label, [])
        assert [entry["key"] for entry in got] == users
        for entry in got:
            assert entry["n"] == len(rows[entry["key"]])
            assert entry["counts"][str(yes_no.id)].get(label) == rows[
                entry["key"]
            ].count(label)
            # Every question's answers, as in groups.user.
            assert sum(entry["counts"][str(category.id)].values()) == entry["n"]
    assert set(by_answer[str(category.id)]) <= {
        "Order status",
        "Return or refund",
        "Something else",
    }


@pytest.mark.django_db
def test_answers_from_elsewhere_are_copied_once_and_a_retry_recounts(
    auth_client, observe_project, yes_no, category, answered_run, started
):
    from tracer.models.instant_eval import InstantEvalAnswer

    task, ids = answered_run
    InstantEvalAnswer.objects.filter(task_id=task.id).delete()
    InstantEvalRun.objects.filter(eval_task_id=task.id).update(answers_synced=False)
    first = _summary(auth_client, observe_project, task)
    assert first["answered"] == 11
    assert InstantEvalAnswer.objects.filter(task_id=task.id).count() == 24
    version = InstantEvalRun.objects.get(eval_task_id=task.id).answers_version
    retried = auth_client.post(
        CONTROL,
        {
            "project_id": str(observe_project.id),
            "eval_task_id": str(task.id),
            "action": "retry_failed",
        },
        format="json",
    )
    assert retried.status_code == 200
    assert (
        InstantEvalRun.objects.get(eval_task_id=task.id).answers_version == version + 1
    )
    # The failed answer waits again.
    assert InstantEvalAnswer.objects.filter(task_id=task.id).count() == 23
    EvalTask.objects.filter(id=task.id).update(status=EvalTaskStatus.RUNNING)
    again = _summary(auth_client, observe_project, task)
    assert (again["failed"], again["pending"]) == (0, 1)


@pytest.mark.django_db
def test_model_by_day_groups_and_selects_rows(
    auth_client, observe_project, yes_no, answered_run
):
    task, ids = answered_run
    s = _summary(auth_client, observe_project, task)
    model_day = {g["key"]: g for g in s["groups"]["model_day"]}
    assert sum(g["n"] for g in model_day.values()) == 12
    key, entry = next(iter(model_day.items()))
    model, _, day = key.partition("|")
    assert entry["label"].startswith(model)
    page = auth_client.get(
        ROWS,
        {
            "project_id": str(observe_project.id),
            "eval_task_id": str(task.id),
            "tz": "UTC",
            "group": f"model_day:{key}",
        },
    ).json()["result"]
    assert page["total"] == entry["n"]
    assert all(
        r["facets"]["model"] == model and r["time"].startswith(day)
        for r in page["rows"]
    )


@pytest.mark.django_db
def test_a_plan_quota_limits_the_estimate_and_refuses_the_start(
    auth_client, observe_project, yes_no, fake_view, started, monkeypatch
):
    monkeypatch.setattr(
        instant_eval_scale,
        "jev_quota",
        lambda org: {
            "per_minute": 50,
            "per_hour": 300,
            "per_day": 1000,
            "used_day": 990,
        },
    )
    estimate = auth_client.post(
        ESTIMATE,
        {
            "project_id": str(observe_project.id),
            "unit": "sessions",
            "filters": WINDOW,
            "sample_size": 20,
            "questions": 1,
        },
        format="json",
    ).json()["result"]
    assert estimate["quota_limited"] is True
    assert estimate["quota_max_rows"] == 10
    assert "10 more Jev answers" in estimate["quota_message"]
    # 300 an hour: 20 answers take 4 minutes, not seconds, and the composer
    # says the plan's pace is why.
    assert estimate["seconds_estimate"] == 10 + 20 * 60 // 5
    assert estimate["plan_rate_per_min"] == 5.0
    refused = _start(auth_client, observe_project, [yes_no], sample_size=20)
    assert refused.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert refused.json()["result"]["error_code"] == "INSTANT_EVAL_QUOTA"
    assert (
        _start(auth_client, observe_project, [yes_no], sample_size=10).status_code
        == 200
    )


@pytest.mark.django_db
def test_history_lists_a_runs_questions_in_the_order_it_asked_them(
    auth_client, observe_project, yes_no, category, fake_view, started
):
    result = _start(
        auth_client, observe_project, [category, yes_no], sample_size=2
    ).json()["result"]
    runs = auth_client.get(
        "/tracer/instant-eval/runs/",
        {"project_id": str(observe_project.id), "page_size": 5},
    ).json()["result"]["runs"]
    run = next(r for r in runs if r["task_id"] == result["task_id"])
    assert run["config_ids"] == [str(category.id), str(yes_no.id)]
    assert run["questions"][0] == category.config["instant_eval"]["question"]


@pytest.mark.django_db
def test_a_paused_run_gives_back_entries_instead_of_asking_jev(
    auth_client, observe_project, yes_no, fake_view, started, monkeypatch
):
    from tfc.temporal.eval_tasks import activities

    task = _running_with_unanswered(auth_client, observe_project, yes_no)
    entry = EvalLogger.objects.filter(
        eval_task_id=str(task.id), status=EvalEntryStatus.PENDING
    ).first()
    EvalLogger.objects.filter(id=entry.id).update(status=EvalEntryStatus.RUNNING)
    EvalTask.objects.filter(id=task.id).update(status=EvalTaskStatus.PAUSED)

    def jev(*args, **kwargs):
        raise AssertionError("a paused run must not ask Jev")

    monkeypatch.setattr("tracer.services.eval_tasks.run_entry.run_entry", jev)
    # The activity recycles connections; the test's transaction keeps its own.
    monkeypatch.setattr(activities, "close_old_connections", lambda: None)
    out = activities._run_entry_sync(str(entry.id))
    assert out["status"] == "paused"
    entry.refresh_from_db()
    assert entry.status == EvalEntryStatus.PENDING

    # The page says the pause is draining while answers are still in flight.
    EvalLogger.objects.filter(
        eval_task_id=str(task.id), status=EvalEntryStatus.PENDING
    ).exclude(id=entry.id).update(
        status=EvalEntryStatus.RUNNING, updated_at=datetime.now(UTC)
    )
    summary = _summary(auth_client, observe_project, task)
    assert (summary["status"], summary["in_flight"]) == ("pausing", 2)
    EvalLogger.objects.filter(
        eval_task_id=str(task.id), status=EvalEntryStatus.RUNNING
    ).update(status=EvalEntryStatus.PENDING)
    summary = _summary(auth_client, observe_project, task, tz="Asia/Tokyo")
    assert (summary["status"], summary["in_flight"]) == ("paused", 0)


@pytest.mark.django_db
def test_a_quiet_running_run_says_it_waits_for_workers(
    auth_client, observe_project, yes_no, fake_view, started, monkeypatch
):
    task = _running_with_unanswered(auth_client, observe_project, yes_no)
    # The workflow is alive (not stalled): the run is just waiting.
    monkeypatch.setattr(
        "tfc.temporal.eval_tasks.client.describe_eval_task_workflow_sync",
        lambda task_id: "progressing",
    )
    EvalTask.objects.filter(id=task.id).update(
        start_time=datetime.now(UTC) - timedelta(minutes=30)
    )
    summary = _summary(auth_client, observe_project, task)
    assert summary["status"] == "running"
    assert summary["waiting_s"] >= 600
    # Resumed just now: not waiting for the time it spent paused.
    EvalTask.objects.filter(id=task.id).update(start_time=datetime.now(UTC))
    resumed = _summary(auth_client, observe_project, task, tz="Asia/Tokyo")
    assert resumed["waiting_s"] is None


def test_a_lost_worker_is_told_apart_from_a_failed_answer():
    from temporalio.exceptions import ActivityError, ApplicationError, TimeoutType
    from temporalio.exceptions import TimeoutError as ActivityTimeoutError

    from tfc.temporal.eval_tasks.workflows import _worker_lost

    def failed(cause):
        error = ActivityError(
            "activity failed",
            scheduled_event_id=1,
            started_event_id=2,
            identity="worker",
            activity_type="run_eval_entry_activity",
            activity_id="1",
            retry_state=None,
        )
        error.__cause__ = cause
        return error

    lost = ActivityTimeoutError(
        "heartbeat", type=TimeoutType.HEARTBEAT, last_heartbeat_details=[]
    )
    slow = ActivityTimeoutError(
        "start to close", type=TimeoutType.START_TO_CLOSE, last_heartbeat_details=[]
    )
    assert _worker_lost(failed(lost))
    assert not _worker_lost(failed(slow))
    assert not _worker_lost(failed(ApplicationError("Jev said no")))
    assert not _worker_lost(RuntimeError("not an activity"))


@pytest.mark.django_db
def test_instant_eval_answers_stay_out_of_error_feed_clustering(
    auth_client, observe_project, yes_no, answered_run, monkeypatch
):
    from tracer.queries.eval_clustering import get_unclustered_eval_results
    from tracer.services.eval_tasks import run_entry

    task, ids = answered_run
    # The same failing answer, from this run and from a regular eval task.
    instant = EvalLogger.objects.get(
        eval_task_id=str(task.id), trace_session_id=ids[1], custom_eval_config=yes_no
    )
    EvalLogger.objects.filter(id=instant.id).update(
        output_bool=False,
        eval_explanation="the customer left without an answer",
        status=EvalEntryStatus.COMPLETED,
    )
    instant.refresh_from_db()
    regular = EvalLogger.objects.create(
        target_type=EvalTargetType.SESSION,
        trace_session_id=ids[2],
        eval_task_id="regular-eval-task",
        custom_eval_config=yes_no,
        output_bool=False,
        eval_explanation="the customer left without an answer",
        status=EvalEntryStatus.COMPLETED,
    )
    fetched = {
        r.eval_logger_id for r in get_unclustered_eval_results(str(observe_project.id))
    }
    assert str(regular.id) in fetched
    assert str(instant.id) not in fetched

    dispatched = []
    monkeypatch.setattr(
        "tracer.tasks.eval_clustering.dispatch_eval_clustering", dispatched.append
    )
    monkeypatch.setattr(
        "tracer.queries.eval_clustering.is_clusterable_eval_failure", lambda e: True
    )
    run_entry._reseed_eval_clustering(instant, observe_project.id)
    assert dispatched == []
    run_entry._reseed_eval_clustering(regular, observe_project.id)
    assert dispatched == [observe_project.id]


@pytest.mark.django_db
def test_a_run_reports_the_time_it_ran_apart_from_the_time_it_sat(
    auth_client, observe_project, answered_run
):
    from tracer.models.instant_eval import InstantEvalAnswer

    task, ids = answered_run
    start = datetime.now(UTC) - timedelta(hours=4)
    InstantEvalRun.objects.filter(eval_task_id=task.id).update(created_at=start)
    answers = list(InstantEvalAnswer.objects.filter(task_id=task.id).order_by("id"))
    # Answers land over three distinct minutes: the first hour, then after
    # a long pause, the end.
    for n, answer in enumerate(answers):
        minute = (0, 1, 200)[n % 3]
        InstantEvalAnswer.objects.filter(id=answer.id).update(
            answered_at=start + timedelta(minutes=minute, seconds=5)
        )
    summary = _summary(auth_client, observe_project, task, tz="Asia/Seoul")
    assert summary["active_s"] == 180
    assert summary["idle_s"] == 200 * 60 + 5 - 180
