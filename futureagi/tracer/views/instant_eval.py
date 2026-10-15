"""
Instant eval on the Sessions and Users views.

POST /tracer/instant-eval/user-sessions/   the latest sessions of some users
GET  /tracer/instant-eval/answers/         an Instant eval task's answers, per
                                           trace, session or user

A session question runs as an eval task with ``row_type=sessions`` over the
sessions in view (or the users' sessions). Session results aren't grid
columns, so the answers endpoint returns each answered row with what the
results list shows, and rolls session answers up per user.
"""

import json
from collections import Counter, defaultdict
from datetime import UTC, datetime

import structlog
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from tfc.utils.api_contracts import validated_request
from tfc.utils.api_serializers import ApiErrorResponseSerializer
from tfc.utils.general_methods import GeneralMethods
from tracer.models.eval_task import EvalTask
from tracer.models.observation_span import EvalLogger
from tracer.models.project import Project

logger = structlog.get_logger(__name__)

ERROR_RESPONSES = {
    400: ApiErrorResponseSerializer,
    403: ApiErrorResponseSerializer,
    404: ApiErrorResponseSerializer,
    500: ApiErrorResponseSerializer,
    503: ApiErrorResponseSerializer,
}

ERROR_ANSWER = "__error__"
SKIPPED_ANSWER = "__skipped__"
MAX_USERS = 500
MAX_ANSWER_ROWS = 2000
EXCERPT_CHARS = 280


class InstantEvalUserSessionsSerializer(serializers.Serializer):
    project_id = serializers.UUIDField()
    end_user_ids = serializers.ListField(
        child=serializers.UUIDField(), min_length=1, max_length=MAX_USERS
    )
    window = serializers.ListField(
        child=serializers.DateTimeField(), required=False, max_length=2
    )
    per_user = serializers.IntegerField(min_value=1, max_value=20, required=False, default=5)


class InstantEvalUserSessionSerializer(serializers.Serializer):
    session_id = serializers.CharField()
    end_user_id = serializers.CharField()
    start_time = serializers.CharField(allow_null=True)


class InstantEvalUserSessionsResultSerializer(serializers.Serializer):
    sessions = InstantEvalUserSessionSerializer(many=True)
    users = serializers.IntegerField()


class InstantEvalUserSessionsResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = InstantEvalUserSessionsResultSerializer()


class InstantEvalAnswersQuerySerializer(serializers.Serializer):
    project_id = serializers.UUIDField()
    eval_task_id = serializers.UUIDField()
    unit = serializers.ChoiceField(choices=["traces", "spans", "sessions", "users"])
    config_ids = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class InstantEvalAnswerSerializer(serializers.Serializer):
    answer = serializers.CharField(allow_null=True)
    explanation = serializers.CharField(allow_blank=True, allow_null=True)
    confidence = serializers.FloatField(allow_null=True, required=False)
    status = serializers.CharField(required=False, allow_blank=True)
    counts = serializers.DictField(child=serializers.IntegerField(), required=False)


class InstantEvalAnswerRowSerializer(serializers.Serializer):
    id = serializers.CharField()
    label = serializers.CharField(allow_blank=True)
    excerpt = serializers.CharField(allow_blank=True)
    time = serializers.CharField(allow_null=True)
    user_id = serializers.CharField(allow_blank=True, allow_null=True)
    end_user_id = serializers.CharField(allow_blank=True, allow_null=True)
    sessions = serializers.IntegerField(required=False)
    trace_id = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    answers = serializers.DictField(child=InstantEvalAnswerSerializer())


class InstantEvalAnswersResultSerializer(serializers.Serializer):
    unit = serializers.CharField()
    rows = InstantEvalAnswerRowSerializer(many=True)
    counts = serializers.DictField(child=serializers.DictField(child=serializers.IntegerField()))
    answered = serializers.IntegerField()
    pending = serializers.IntegerField(required=False)


class InstantEvalAnswersResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = InstantEvalAnswersResultSerializer()


def _org(request):
    return getattr(request, "organization", None) or request.user.organization


def _project(request, project_id):
    return Project.objects.filter(
        id=project_id, organization=_org(request), deleted=False
    ).first()


def _iso(value) -> str | None:
    if isinstance(value, datetime):
        # ClickHouse returns naive UTC datetimes.
        return (value if value.tzinfo else value.replace(tzinfo=UTC)).isoformat()
    return str(value) if value else None


def _clip(text: str) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= EXCERPT_CHARS else text[: EXCERPT_CHARS - 1] + "…"


IN_FLIGHT = frozenset({"pending", "running"})


def answer_of(log) -> str | None:
    """The label an Instant eval gave, an error/skipped marker, or None while
    the row is still queued or being read."""
    if getattr(log, "status", None) in IN_FLIGHT:
        return None
    if log.error:
        return ERROR_ANSWER
    if log.skipped_reason:
        return SKIPPED_ANSWER
    labels = log.output_str_list or []
    if labels:
        return str(labels[0])
    if log.output_str:
        try:
            parsed = json.loads(log.output_str)
            if isinstance(parsed, dict) and parsed.get("choice"):
                return str(parsed["choice"])
        except ValueError:
            return log.output_str
    return None


def confidence_of(log) -> float | None:
    """Jev's confidence in its answer (0-1), when it reported one."""
    jev = (log.output_metadata or {}).get("jev") or {}
    value = jev.get("confidence")
    return float(value) if isinstance(value, int | float) else None


def _latest_logs(eval_task_id: str, config_ids: list[str], key: str):
    """Newest result per (row, evaluator) of one task."""
    logs = EvalLogger.objects.filter(eval_task_id=str(eval_task_id), deleted=False)
    if config_ids:
        logs = logs.filter(custom_eval_config_id__in=config_ids)
    latest: dict[tuple[str, str], EvalLogger] = {}
    for log in logs.order_by("created_at")[: MAX_ANSWER_ROWS * max(1, len(config_ids) or 1)]:
        row = getattr(log, key)
        if row is None:
            continue
        latest[(str(row), str(log.custom_eval_config_id))] = log
    return latest


def _session_display(project_id: str, session_ids: list[str]) -> dict[str, dict]:
    from ee.agenthub.insights.units import _message_text, _user_labels
    from tracer.services.clickhouse.v2 import get_reader

    if not session_ids:
        return {}
    with get_reader() as reader:
        roots = reader.roots_by_session_ids(session_ids, project_id=project_id)
    by_session: dict[str, dict] = {}
    for span in roots:
        sid = str(span.trace_session_id)
        entry = by_session.setdefault(
            sid,
            {
                "time": _iso(span.start_time),
                "end_user_id": str(span.end_user_id) if span.end_user_id else None,
                "excerpt": "",
                "turns": 0,
            },
        )
        entry["turns"] += 1
        if not entry["excerpt"]:
            attrs = span.attrs_string or {}
            entry["excerpt"] = _clip(_message_text(attrs.get("input.value") or span.input))
    labels = _user_labels(e["end_user_id"] for e in by_session.values())
    for entry in by_session.values():
        entry["user_id"] = labels.get(entry["end_user_id"] or "", "")
    return by_session


def _trace_display(project_id: str, trace_ids: list[str]) -> dict[str, dict]:
    from ee.agenthub.insights.units import _message_text, _user_labels
    from tracer.services.clickhouse.v2 import get_reader

    if not trace_ids:
        return {}
    with get_reader() as reader:
        roots = reader.roots_by_trace_ids(trace_ids, project_id=project_id)
    out: dict[str, dict] = {}
    for span in roots:
        attrs = span.attrs_string or {}
        out[str(span.trace_id)] = {
            "time": _iso(span.start_time),
            "end_user_id": str(span.end_user_id) if span.end_user_id else None,
            "excerpt": _clip(_message_text(attrs.get("input.value") or span.input)),
        }
    labels = _user_labels(e["end_user_id"] for e in out.values())
    for entry in out.values():
        entry["user_id"] = labels.get(entry["end_user_id"] or "", "")
    return out


def _span_display(project_id: str, span_ids: list[str]) -> dict[str, dict]:
    from ee.agenthub.insights.units import _message_text, _user_labels
    from tracer.services.clickhouse.v2 import get_reader

    if not span_ids:
        return {}
    with get_reader() as reader:
        spans = reader.list_by_ids(span_ids, include_heavy=False, project_id=project_id)
    out: dict[str, dict] = {}
    for span in spans:
        attrs = span.attrs_string or {}
        kind = str(getattr(span, "observation_type", "") or "span").lower()
        text = _clip(_message_text(attrs.get("input.value") or span.input))
        out[str(span.id)] = {
            "time": _iso(span.start_time),
            "end_user_id": str(span.end_user_id) if span.end_user_id else None,
            "excerpt": f"{kind} · {span.name}: {text}" if text else f"{kind} · {span.name}",
            "trace_id": str(span.trace_id),
        }
    labels = _user_labels(e["end_user_id"] for e in out.values())
    for entry in out.values():
        entry["user_id"] = labels.get(entry["end_user_id"] or "", "")
    return out


def _tally(rows: list[dict], config_ids: list[str]) -> dict[str, dict[str, int]]:
    counts: dict[str, Counter] = {c: Counter() for c in config_ids}
    for row in rows:
        for config_id, answer in row["answers"].items():
            if row.get("sessions") is not None:
                # A user counts once under every label any of their sessions got.
                for label in answer.get("counts", {}):
                    counts.setdefault(config_id, Counter())[label] += 1
            elif answer["answer"] is not None:
                counts.setdefault(config_id, Counter())[answer["answer"]] += 1
    return {c: dict(v) for c, v in counts.items()}


def _user_rollup(session_rows: list[dict]) -> list[dict]:
    """Session answers per user: label counts and the most common label."""
    by_user: dict[str, list[dict]] = defaultdict(list)
    for row in session_rows:
        by_user[row["end_user_id"] or ""].append(row)
    users = []
    for end_user_id, rows in by_user.items():
        if not end_user_id:
            continue
        rows.sort(key=lambda r: r["time"] or "")
        answers = {}
        config_ids = {c for r in rows for c in r["answers"]}
        for config_id in config_ids:
            labels = Counter(
                r["answers"][config_id]["answer"]
                for r in rows
                if config_id in r["answers"] and r["answers"][config_id]["answer"]
            )
            top = [label for label, _ in labels.most_common() if not label.startswith("__")]
            in_flight = any(
                r["answers"].get(config_id, {}).get("status") in IN_FLIGHT for r in rows
            )
            answers[config_id] = {
                "answer": top[0] if top else (next(iter(labels), None)),
                "explanation": "",
                "counts": dict(labels),
                "status": "running" if in_flight else "completed",
            }
        users.append(
            {
                "id": end_user_id,
                "label": rows[0]["user_id"] or end_user_id,
                "excerpt": rows[-1]["excerpt"],
                "time": rows[-1]["time"],
                "user_id": rows[0]["user_id"],
                "end_user_id": end_user_id,
                "sessions": len(rows),
                "answers": answers,
            }
        )
    users.sort(key=lambda u: u["time"] or "", reverse=True)
    return users


class InstantEvalUserSessionsView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        request_serializer=InstantEvalUserSessionsSerializer,
        responses={200: InstantEvalUserSessionsResponseSerializer, **ERROR_RESPONSES},
    )
    def post(self, request):
        """The latest sessions of each user, for asking a question per user."""
        from tracer.services.clickhouse.v2 import get_reader

        data = request.validated_data
        project = _project(request, data["project_id"])
        if project is None:
            return self._gm.not_found("Project not found")
        window = data.get("window") or []
        since = window[0] if len(window) > 0 else None
        until = window[1] if len(window) > 1 else None
        try:
            with get_reader() as reader:
                roots = reader.roots_by_end_user_ids(
                    [str(u) for u in data["end_user_ids"]],
                    project_id=str(project.id),
                    since=since,
                    until=until,
                )
        except Exception:
            logger.exception("instant_eval_user_sessions_failed")
            return self._gm.custom_error_response(
                503, "Sessions are temporarily unavailable. Please retry."
            )
        first_seen: dict[str, tuple[str, datetime]] = {}
        for span in roots:
            if not span.trace_session_id or not span.end_user_id:
                continue
            sid = str(span.trace_session_id)
            if sid not in first_seen or span.start_time < first_seen[sid][1]:
                first_seen[sid] = (str(span.end_user_id), span.start_time)
        by_user: dict[str, list[tuple[str, datetime]]] = defaultdict(list)
        for sid, (user, start) in first_seen.items():
            by_user[user].append((sid, start))
        sessions = []
        for user, items in by_user.items():
            items.sort(key=lambda x: x[1], reverse=True)
            sessions.extend(
                {"session_id": sid, "end_user_id": user, "start_time": _iso(start)}
                for sid, start in items[: data["per_user"]]
            )
        return self._gm.success_response({"sessions": sessions, "users": len(by_user)})


class InstantEvalAnswersView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        query_serializer=InstantEvalAnswersQuerySerializer,
        responses={200: InstantEvalAnswersResponseSerializer, **ERROR_RESPONSES},
    )
    def get(self, request):
        """Answers of an Instant eval task, per trace, session or user."""
        params = request.validated_query_data
        project = _project(request, params["project_id"])
        if project is None:
            return self._gm.not_found("Project not found")
        task = EvalTask.objects.filter(
            id=params["eval_task_id"], project=project, deleted=False
        ).first()
        if task is None:
            return self._gm.not_found("Eval task not found")
        config_ids = [c for c in (params.get("config_ids") or "").split(",") if c][:10]
        unit = params["unit"]
        key = {"traces": "trace_id", "spans": "observation_span_id"}.get(
            unit, "trace_session_id"
        )
        latest = _latest_logs(str(task.id), config_ids, key)
        answers: dict[str, dict] = defaultdict(dict)
        for (row_id, config_id), log in latest.items():
            answers[row_id][config_id] = {
                "answer": answer_of(log),
                "explanation": (log.eval_explanation or "")[:2000],
                "confidence": confidence_of(log),
                "status": log.status,
            }
        row_ids = list(answers)[:MAX_ANSWER_ROWS]
        try:
            reader_for = {"traces": _trace_display, "spans": _span_display}
            display = reader_for.get(unit, _session_display)(str(project.id), row_ids)
        except Exception:
            logger.exception("instant_eval_answers_display_failed")
            display = {}
        rows = []
        for row_id in row_ids:
            shown = display.get(row_id, {})
            rows.append(
                {
                    "id": row_id,
                    "label": shown.get("excerpt", "") or row_id,
                    "excerpt": shown.get("excerpt", ""),
                    "time": shown.get("time"),
                    "user_id": shown.get("user_id", ""),
                    "end_user_id": shown.get("end_user_id"),
                    "trace_id": shown.get("trace_id"),
                    "answers": answers[row_id],
                }
            )
        if unit == "users":
            rows = _user_rollup(rows)
        else:
            rows.sort(key=lambda r: r["time"] or "", reverse=True)
        settled = sum(
            1
            for row in rows
            if all(
                a.get("status") not in IN_FLIGHT
                for a in row["answers"].values()
            )
        )
        return self._gm.success_response(
            {
                "unit": unit,
                "rows": rows,
                "counts": _tally(rows, config_ids),
                "answered": settled,
                "pending": len(rows) - settled,
            }
        )
