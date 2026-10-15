"""Instant eval on Sessions and Users: the answers endpoint, the per-user
roll-up, the user-to-sessions lookup and the session transcript input."""

import uuid
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from rest_framework import status

from accounts.models.organization import Organization
from model_hub.models.ai_model import AIModel
from tracer.models.custom_eval_config import CustomEvalConfig
from tracer.models.eval_task import EvalTask, EvalTaskStatus, RowType, RunType
from tracer.models.observation_span import EvalLogger, EvalTargetType
from tracer.models.project import Project
from tracer.utils.eval import render_session_transcript
from tracer.views import instant_eval

ANSWERS = "/tracer/instant-eval/answers/"
USER_SESSIONS = "/tracer/instant-eval/user-sessions/"


@pytest.fixture
def question(observe_project, eval_template):
    return CustomEvalConfig.objects.create(
        name="Did the customer get what they came for?",
        project=observe_project,
        eval_template=eval_template,
        config={"instant_eval": {"question": "q", "reads": "transcript", "unit": "sessions"}},
        mapping={"transcript": "transcript"},
        filters={},
    )


@pytest.fixture
def session_task(observe_project, question):
    task = EvalTask.objects.create(
        project=observe_project,
        name="Instant eval · q",
        filters={},
        sampling_rate=100,
        spans_limit=10,
        run_type=RunType.HISTORICAL,
        status=EvalTaskStatus.COMPLETED,
        row_type=RowType.SESSIONS,
    )
    task.evals.add(question)
    return task


def log(task, config, session_id, label=None, *, error=False, confidence=0.9):
    return EvalLogger(
        target_type=EvalTargetType.SESSION,
        trace_session_id=session_id,
        eval_task_id=str(task.id),
        custom_eval_config=config,
        output_str_list=[label] if label else [],
        error=error,
        output_metadata={"jev": {"confidence": confidence}},
    )


@pytest.fixture
def sessions(observe_project, monkeypatch):
    """Three sessions: two from one user, one from another."""
    ids = [str(uuid.uuid4()) for _ in range(3)]
    users = ["eu-1", "eu-1", "eu-2"]
    base = datetime(2026, 10, 14, 10)
    shown = {
        sid: {
            "time": (base + timedelta(hours=i)).isoformat(),
            "end_user_id": users[i],
            "user_id": f"cust_{users[i]}",
            "excerpt": f"first message {i}",
        }
        for i, sid in enumerate(ids)
    }
    monkeypatch.setattr(instant_eval, "_session_display", lambda project_id, row_ids: shown)
    return ids


@pytest.mark.django_db
def test_session_answers_come_back_per_session_newest_first(
    auth_client, observe_project, session_task, question, sessions
):
    EvalLogger.objects.bulk_create([
        log(session_task, question, sessions[0], "Yes"),
        log(session_task, question, sessions[1], "No", confidence=0.4),
        log(session_task, question, sessions[2], error=True),
    ])
    response = auth_client.get(ANSWERS, {
        "project_id": str(observe_project.id),
        "eval_task_id": str(session_task.id),
        "unit": "sessions",
        "config_ids": str(question.id),
    })
    assert response.status_code == status.HTTP_200_OK
    result = response.json()["result"]
    assert [r["id"] for r in result["rows"]] == list(reversed(sessions))
    answers = {r["id"]: r["answers"][str(question.id)] for r in result["rows"]}
    assert answers[sessions[0]]["answer"] == "Yes"
    assert answers[sessions[1]] == {"answer": "No", "explanation": "", "confidence": 0.4, "status": "completed"}
    assert answers[sessions[2]]["answer"] == instant_eval.ERROR_ANSWER
    assert result["counts"][str(question.id)] == {"Yes": 1, "No": 1, "__error__": 1}


@pytest.mark.django_db
def test_user_answers_roll_up_each_users_sessions(
    auth_client, observe_project, session_task, question, sessions
):
    EvalLogger.objects.bulk_create([
        log(session_task, question, sessions[0], "Yes"),
        log(session_task, question, sessions[1], "No"),
        log(session_task, question, sessions[2], "No"),
    ])
    response = auth_client.get(ANSWERS, {
        "project_id": str(observe_project.id),
        "eval_task_id": str(session_task.id),
        "unit": "users",
        "config_ids": str(question.id),
    })
    result = response.json()["result"]
    by_user = {r["id"]: r for r in result["rows"]}
    assert by_user["eu-1"]["sessions"] == 2
    assert by_user["eu-1"]["answers"][str(question.id)]["counts"] == {"Yes": 1, "No": 1}
    assert by_user["eu-2"]["answers"][str(question.id)]["answer"] == "No"
    # A user counts once under every answer any of their sessions got.
    assert result["counts"][str(question.id)] == {"Yes": 1, "No": 2}


@pytest.mark.django_db
def test_a_rerun_shows_only_the_live_answer(
    auth_client, observe_project, session_task, question, sessions
):
    # A rerun retires the previous result (only one live row per session).
    replaced = log(session_task, question, sessions[0], "No")
    replaced.deleted = True
    EvalLogger.objects.bulk_create([replaced])
    EvalLogger.objects.bulk_create([log(session_task, question, sessions[0], "Yes")])
    result = auth_client.get(ANSWERS, {
        "project_id": str(observe_project.id),
        "eval_task_id": str(session_task.id),
        "unit": "sessions",
    }).json()["result"]
    assert len(result["rows"]) == 1
    assert result["rows"][0]["answers"][str(question.id)]["answer"] == "Yes"


@pytest.mark.django_db
def test_answers_of_another_organizations_task_are_not_found(auth_client, session_task):
    other = Organization.objects.create(name="Other org")
    project = getattr(Project, "no_workspace_objects", Project.objects).create(
        name="Elsewhere",
        organization=other,
        model_type=AIModel.ModelTypes.GENERATIVE_LLM,
        trace_type="observe",
    )
    response = auth_client.get(ANSWERS, {
        "project_id": str(project.id),
        "eval_task_id": str(session_task.id),
        "unit": "sessions",
    })
    assert response.status_code == status.HTTP_404_NOT_FOUND


class _Reader:
    def __init__(self, roots):
        self.roots = roots
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def roots_by_end_user_ids(self, ids, *, project_id, since=None, until=None):
        self.calls.append((ids, project_id, since, until))
        return self.roots


@pytest.mark.django_db
def test_user_sessions_returns_each_users_latest_sessions(
    auth_client, observe_project, monkeypatch
):
    user = str(uuid.uuid4())
    base = datetime(2026, 10, 1)
    roots = [
        SimpleNamespace(trace_session_id=f"s{i}", end_user_id=user,
                        start_time=base + timedelta(days=i))
        for i in range(4)
    ] + [SimpleNamespace(trace_session_id="s3", end_user_id=user, start_time=base)]
    reader = _Reader(roots)
    monkeypatch.setattr("tracer.services.clickhouse.v2.get_reader", lambda: reader)
    response = auth_client.post(USER_SESSIONS, {
        "project_id": str(observe_project.id),
        "end_user_ids": [user],
        "per_user": 2,
    }, format="json")
    assert response.status_code == status.HTTP_200_OK
    result = response.json()["result"]
    assert result["users"] == 1
    # Newest first, each session once, at most per_user of them.
    assert [s["session_id"] for s in result["sessions"]] == ["s2", "s1"]
    assert reader.calls[0][1] == str(observe_project.id)


def test_transcript_renders_ordered_turns_and_keeps_the_ends_when_long():
    traces = [
        SimpleNamespace(
            input='[{"role": "user", "content": "where is order 1?"}]' if i == 0 else f"q{i}",
            output=f"a{i}",
        )
        for i in range(3)
    ]
    text = render_session_transcript(traces)
    assert text.startswith("[Turn 1] User: where is order 1?\nAssistant: a0")
    assert "[Turn 3] User: q2\nAssistant: a2" in text

    long = [SimpleNamespace(input="x" * 3900, output="y" * 3900) for _ in range(30)]
    clipped = render_session_transcript(long)
    assert len(clipped) <= 60000 + 200
    assert clipped.startswith("[Turn 1]") and "[Turn 30]" in clipped
    assert "turns omitted" in clipped
