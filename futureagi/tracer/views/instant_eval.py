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
from django.core.cache import cache
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from tfc.utils.api_contracts import validated_request
from tfc.utils.api_serializers import ApiErrorResponseSerializer
from tfc.utils.general_methods import GeneralMethods
from tracer.models.eval_task import EvalTask
from tracer.models.instant_eval import InstantEvalRun
from tracer.models.observation_span import EvalLogger
from tracer.models.project import Project
from tracer.views._license import InstantEvalLicenseRequired

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
    # Only the answer counts (History's split bars): no rows in the response.
    counts_only = serializers.BooleanField(required=False, default=False)


class InstantEvalAnswerSerializer(serializers.Serializer):
    answer = serializers.CharField(allow_null=True)
    explanation = serializers.CharField(allow_blank=True, allow_null=True)
    confidence = serializers.FloatField(allow_null=True, required=False)
    status = serializers.CharField(required=False, allow_blank=True)
    counts = serializers.DictField(child=serializers.IntegerField(), required=False)


class InstantEvalRowFacetsSerializer(serializers.Serializer):
    model = serializers.CharField(allow_null=True, allow_blank=True)
    turns = serializers.IntegerField(allow_null=True)
    duration_ms = serializers.IntegerField(allow_null=True)
    error = serializers.BooleanField()


class InstantEvalAnswerRowSerializer(serializers.Serializer):
    id = serializers.CharField()
    label = serializers.CharField(allow_blank=True)
    excerpt = serializers.CharField(allow_blank=True)
    time = serializers.CharField(allow_null=True)
    user_id = serializers.CharField(allow_blank=True, allow_null=True)
    end_user_id = serializers.CharField(allow_blank=True, allow_null=True)
    sessions = serializers.IntegerField(required=False)
    trace_id = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    facets = InstantEvalRowFacetsSerializer(required=False)
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


def _is_error(span) -> bool:
    return str(getattr(span, "status", "") or "").upper() == "ERROR"


def _span_model(span) -> str | None:
    attrs = getattr(span, "attrs_string", None) or {}
    return getattr(span, "model", None) or attrs.get("llm.model_name") or None


def _facets(model=None, turns=None, duration_ms=None, error=False) -> dict:
    """What a row can be grouped by on the Ask page: the model that answered,
    how many turns a session had, how long it took and whether any of it
    errored. Any of them may be unknown (None)."""
    return {
        "model": model or None,
        "turns": turns,
        "duration_ms": int(duration_ms) if duration_ms is not None else None,
        "error": bool(error),
    }


def _models(reader, column: str, ids: list[str], project_id: str) -> dict[str, str]:
    try:
        return reader.models_by_group(column, ids, project_id=project_id)
    except Exception:
        logger.exception("instant_eval_models_failed")
        return {}


def _session_display(project_id: str, session_ids: list[str]) -> dict[str, dict]:
    from ee.agenthub.insights.units import _message_text, _user_labels
    from tracer.services.clickhouse.v2 import get_reader

    if not session_ids:
        return {}
    with get_reader() as reader:
        roots = reader.roots_by_session_ids(session_ids, project_id=project_id)
        models = _models(reader, "trace_session_id", session_ids, project_id)
    by_session: dict[str, dict] = {}
    spans_of: dict[str, list] = defaultdict(list)
    for span in roots:
        sid = str(span.trace_session_id)
        spans_of[sid].append(span)
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
    for sid, entry in by_session.items():
        spans = spans_of[sid]
        start = min(s.start_time for s in spans)
        ends = [s.end_time for s in spans if s.end_time]
        duration = (max(ends) - start).total_seconds() * 1000 if ends else None
        entry["facets"] = _facets(
            model=models.get(sid) or next((_span_model(s) for s in spans if _span_model(s)), None),
            turns=entry["turns"],
            duration_ms=duration if duration is None or duration >= 0 else None,
            error=any(_is_error(s) for s in spans),
        )
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
        models = _models(reader, "trace_id", trace_ids, project_id)
    out: dict[str, dict] = {}
    for span in roots:
        attrs = span.attrs_string or {}
        tid = str(span.trace_id)
        out[tid] = {
            "time": _iso(span.start_time),
            "end_user_id": str(span.end_user_id) if span.end_user_id else None,
            "excerpt": _clip(_message_text(attrs.get("input.value") or span.input)),
            "facets": _facets(
                model=models.get(tid) or _span_model(span),
                duration_ms=span.latency_ms,
                error=_is_error(span),
            ),
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
            "facets": _facets(
                model=_span_model(span),
                duration_ms=span.latency_ms,
                error=_is_error(span),
            ),
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


def _user_facets(rows: list[dict]) -> dict:
    """A user's sessions as one row: their most used model, every turn, the
    time all their sessions took, and whether any of them errored."""
    facets = [r.get("facets") or {} for r in rows]
    models = Counter(f["model"] for f in facets if f.get("model"))
    turns = [f["turns"] for f in facets if f.get("turns") is not None]
    durations = [f["duration_ms"] for f in facets if f.get("duration_ms") is not None]
    return _facets(
        model=models.most_common(1)[0][0] if models else None,
        turns=sum(turns) if turns else None,
        duration_ms=sum(durations) if durations else None,
        error=any(f.get("error") for f in facets),
    )


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
            # A session not read yet keeps its user in flight too.
            in_flight = any(
                config_id not in r["answers"]
                or r["answers"][config_id].get("status") in IN_FLIGHT
                for r in rows
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
                "facets": _user_facets(rows),
                "answers": answers,
            }
        )
    users.sort(key=lambda u: u["time"] or "", reverse=True)
    return users


DISPLAY_TTL = 600


def _cached_display(project_id: str, unit: str, row_ids: list[str]) -> dict[str, dict]:
    """What each row shows (excerpt, time, user) never changes during a run,
    so it is read from ClickHouse once and cached; polls only read answers."""
    kind = {"traces": "traces", "spans": "spans"}.get(unit, "sessions")
    keys = {row_id: f"ie-display:v2:{project_id}:{kind}:{row_id}" for row_id in row_ids}
    cached = cache.get_many(list(keys.values()))
    display = {row_id: cached[key] for row_id, key in keys.items() if key in cached}
    missing = [row_id for row_id in row_ids if row_id not in display]
    if missing:
        reader = {"traces": _trace_display, "spans": _span_display}.get(kind, _session_display)
        try:
            fresh = reader(project_id, missing)
        except Exception:
            logger.exception("instant_eval_answers_display_failed")
            fresh = {}
        if fresh:
            cache.set_many({keys[r]: v for r, v in fresh.items() if r in keys}, DISPLAY_TTL)
        display.update(fresh)
    return display


def _row_settled(row: dict, config_ids: list[str]) -> bool:
    """Every question of the row has its answer. A row with no answer yet
    (named by the task, not read so far) is still pending."""
    answers = row["answers"]
    wanted = config_ids or list(answers)
    return bool(wanted) and all(
        c in answers and answers[c].get("status") not in IN_FLIGHT for c in wanted
    )


def _task_ids(task, unit: str) -> list[str]:
    """The rows a task named outright, in the order it named them."""
    key = {"traces": "trace_id", "spans": "span_id"}.get(unit, "session_id")
    raw = (task.filters or {}).get(key)
    if not isinstance(raw, list | tuple):
        return []
    return list(dict.fromkeys(str(v) for v in raw if v not in (None, "")))


def _summary(unit: str, shown_rows: list[dict], all_rows: list[dict], config_ids) -> dict:
    settled = sum(1 for row in all_rows if _row_settled(row, config_ids))
    return {
        "unit": unit,
        "rows": shown_rows,
        "counts": _tally(all_rows, config_ids),
        "answered": settled,
        "pending": len(all_rows) - settled,
    }


class InstantEvalUserSessionsView(InstantEvalLicenseRequired, APIView):
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


class InstantEvalAnswersView(InstantEvalLicenseRequired, APIView):
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
        # A task that named its rows answers for all of them from the start:
        # rows not read yet come back with no answers, so a run reopened from
        # History shows its whole population.
        row_ids = list(dict.fromkeys(_task_ids(task, unit) + list(answers)))[
            :MAX_ANSWER_ROWS
        ]
        if params.get("counts_only") and unit != "users":
            rows = [{"answers": answers.get(r, {})} for r in row_ids]
            return self._gm.success_response(_summary(unit, [], rows, config_ids))
        display = _cached_display(str(project.id), unit, row_ids)
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
                    "facets": shown.get("facets") or _facets(),
                    "answers": answers.get(row_id, {}),
                }
            )
        if unit == "users":
            rows = _user_rollup(rows)
        else:
            rows.sort(key=lambda r: r["time"] or "", reverse=True)
        shown_rows = [] if params.get("counts_only") else rows
        return self._gm.success_response(_summary(unit, shown_rows, rows, config_ids))


# ─── History ────────────────────────────────────────────────────────────────
HISTORY_SCAN = 500
INSTANT_TASK_PREFIX = "Instant eval"


class InstantEvalRunsQuerySerializer(serializers.Serializer):
    project_id = serializers.UUIDField()
    unit = serializers.ChoiceField(
        choices=["traces", "spans", "sessions", "users"], required=False
    )
    search = serializers.CharField(max_length=200, required=False, allow_blank=True)
    # One run, for a page that opens it by id.
    task_id = serializers.UUIDField(required=False)
    page_number = serializers.IntegerField(min_value=0, required=False, default=0)
    page_size = serializers.IntegerField(min_value=1, max_value=50, required=False, default=20)


class InstantEvalRunSerializer(serializers.Serializer):
    task_id = serializers.CharField()
    name = serializers.CharField(allow_blank=True)
    created_at = serializers.CharField(allow_null=True)
    status = serializers.CharField()
    run_type = serializers.CharField()
    unit = serializers.CharField()
    reads = serializers.CharField(allow_blank=True, allow_null=True)
    rows = serializers.IntegerField()
    config_ids = serializers.ListField(child=serializers.CharField())
    questions = serializers.ListField(child=serializers.CharField())
    counts = serializers.DictField(child=serializers.DictField(child=serializers.IntegerField()))
    answered = serializers.IntegerField()
    pending = serializers.IntegerField()
    # When the last answer landed, once every row has one.
    finished_at = serializers.CharField(allow_null=True, required=False)
    # Runs started from the Ask page: who started it, what it was expected to
    # cost, and how big the view it sampled was.
    created_by = serializers.CharField(allow_null=True, required=False)
    credits_estimate = serializers.FloatField(allow_null=True, required=False)
    population = serializers.IntegerField(allow_null=True, required=False)
    is_sample = serializers.BooleanField(required=False)
    # What the run was asked about: the view's date option, how its scope
    # read, and the window it read ({"from", "to"}).
    date_preset = serializers.CharField(allow_null=True, required=False)
    label = serializers.CharField(allow_null=True, allow_blank=True, required=False)
    window = serializers.JSONField(allow_null=True, required=False)
    # A user question's sessions read; its rows and counts are its users.
    sessions = serializers.IntegerField(allow_null=True, required=False)


class InstantEvalRunsResultSerializer(serializers.Serializer):
    runs = InstantEvalRunSerializer(many=True)
    has_more = serializers.BooleanField()


class InstantEvalRunsResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = InstantEvalRunsResultSerializer()


def _task_rows(task) -> int:
    filters = task.filters or {}
    for key in ("session_id", "trace_id", "span_id"):
        if isinstance(filters.get(key), list):
            return len(filters[key])
    return int(task.spans_limit or 0)


def _legacy_tally(task_ids: list[str], out: dict[str, list]) -> None:
    """Runs whose answers are only in the eval logger: count them there."""
    from django.db import connection

    from tracer.services.instant_eval_summary import LABEL, PENDING

    rid = "COALESCE(l.trace_session_id::text, l.trace_id::text, l.observation_span_id)"
    with connection.cursor() as cur:
        cur.execute(
            f"SELECT l.eval_task_id, count(DISTINCT {rid}), "
            f"count(DISTINCT {rid}) FILTER (WHERE ({LABEL}) <> '{PENDING}'), max(l.updated_at) "
            "FROM tracer_eval_logger l WHERE l.eval_task_id = ANY(%(tasks)s) AND l.deleted = false "
            "GROUP BY l.eval_task_id",
            {"tasks": task_ids},
        )
        for tid, seen, settled, last in cur.fetchall():
            out[tid] = [int(seen), int(settled), last, {}, 0]
        cur.execute(
            f"SELECT l.eval_task_id, l.custom_eval_config_id::text, {LABEL} AS label, count(*) "
            "FROM tracer_eval_logger l WHERE l.eval_task_id = ANY(%(tasks)s) AND l.deleted = false "
            "GROUP BY 1, 2, 3",
            {"tasks": task_ids},
        )
        for tid, cfg, label, n in cur.fetchall():
            if label != PENDING and tid in out:
                out[tid][3].setdefault(cfg, {})[label] = int(n)


def _answer_tally(task_ids: list[str], out: dict[str, list]) -> None:
    """Runs whose answers are recorded as they land: count the narrow table."""
    from django.db import connection

    with connection.cursor() as cur:
        cur.execute(
            "SELECT task_id::text, count(DISTINCT row_id), max(answered_at) "
            "FROM tracer_instant_eval_answer WHERE task_id = ANY(%(tasks)s::uuid[]) "
            "GROUP BY task_id",
            {"tasks": task_ids},
        )
        for tid, settled, last in cur.fetchall():
            out[tid] = [0, int(settled), last, {}, 0]
        cur.execute(
            "SELECT task_id::text, config_id::text, label, count(*) "
            "FROM tracer_instant_eval_answer WHERE task_id = ANY(%(tasks)s::uuid[]) "
            "GROUP BY 1, 2, 3",
            {"tasks": task_ids},
        )
        for tid, cfg, label, n in cur.fetchall():
            out.setdefault(tid, [0, 0, None, {}, 0])[3].setdefault(cfg, {})[label] = (
                int(n)
            )


FINISHED = frozenset({"completed", "failed", "paused"})


def asked_order(task, configs: list) -> list:
    """A run's questions in the order it asked them: as stored when it
    started, else as they were created."""
    asked = [str(c) for c in (task.filters or {}).get("instant_config_ids") or []]
    by_id = {str(c.id): c for c in configs}
    ordered = [by_id[c] for c in asked if c in by_id]
    rest = sorted((c for c in configs if c not in ordered), key=lambda c: c.created_at)
    return ordered + rest


def _history_status(task, run, pending: int) -> str:
    """A run's state for History; a run that ended with rows unanswered
    stopped before finishing."""
    if run is not None and run.cancelled_at:
        return "cancelled"
    status = str(task.status)
    if run is not None and pending and status in ("completed", "failed"):
        return "stalled"
    return status


def _user_tally(task, run, config_ids: list[str], value: list) -> None:
    """A user question counts its users, each once, under their rolled-up
    answer; the rows its run stored are their sessions."""
    from tracer.services.instant_eval_summary import RunView, user_answer_counts, zone

    users, settled, counts = user_answer_counts(
        RunView(
            task_id=str(task.id),
            row_type="sessions",
            unit="users",
            config_ids=config_ids,
            tz=zone("UTC"),
            cancelled=bool(run.cancelled_at),
        )
    )
    value[:] = [users, settled, value[2], counts, users, value[4]]


def _history_tally(page: list[tuple]) -> dict[str, tuple]:
    """Per task: rows logged, rows with an answer, the last update, the
    answer counts per question, the rows its run stored, and for a user
    question the sessions behind its users (its rows are then its users).
    Counted in SQL (from the narrow answer table where the run records one),
    and kept for good once a run has finished."""
    from django.db import connection

    out: dict[str, list] = {}
    keys: dict[str, str] = {}
    for task, run, _ in page:
        if str(task.status) in FINISHED or (run is not None and run.cancelled_at):
            stamp = task.updated_at.timestamp() if task.updated_at else 0
            version = run.answers_version if run is not None else -1
            keys[str(task.id)] = f"ie-history:v2:{task.id}:{version}:{stamp}"
    cached = cache.get_many(list(keys.values())) if keys else {}
    for tid, key in keys.items():
        if key in cached:
            out[tid] = list(cached[key])
    todo = [entry for entry in page if str(entry[0].id) not in out]
    synced = [str(t.id) for t, run, _ in todo if run is not None and run.answers_synced]
    legacy = [str(t.id) for t, run, _ in todo if run is None or not run.answers_synced]
    fresh: dict[str, list] = {}
    if synced:
        _answer_tally(synced, fresh)
    if legacy:
        _legacy_tally(legacy, fresh)
    if todo:
        with connection.cursor() as cur:
            cur.execute(
                "SELECT task_id::text, count(*) FROM tracer_instant_eval_row "
                "WHERE task_id = ANY(%(tasks)s::uuid[]) GROUP BY task_id",
                {"tasks": [str(t.id) for t, _, _ in todo]},
            )
            for tid, n in cur.fetchall():
                fresh.setdefault(tid, [0, 0, None, {}, 0])[4] = int(n)
    for value in fresh.values():
        value.append(None)
    for task, run, config_ids in todo:
        tid = str(task.id)
        if tid in synced and run.unit == "users" and tid in fresh and config_ids:
            _user_tally(task, run, config_ids, fresh[tid])
    for tid, value in fresh.items():
        if tid in synced:
            # Every stored row is logged once the run has picked them.
            value[0] = value[4]
        out[tid] = value
        if tid in keys:
            cache.set(keys[tid], value, None)
    return {tid: tuple(v) for tid, v in out.items()}


class InstantEvalRunsView(InstantEvalLicenseRequired, APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        query_serializer=InstantEvalRunsQuerySerializer,
        responses={200: InstantEvalRunsResponseSerializer, **ERROR_RESPONSES},
    )
    def get(self, request):
        """Past Instant eval runs of a project, newest first, with their answer split."""
        params = request.validated_query_data
        project = _project(request, params["project_id"])
        if project is None:
            return self._gm.not_found("Project not found")
        tasks = EvalTask.objects.filter(
            project=project, deleted=False, name__startswith=INSTANT_TASK_PREFIX
        )
        if params.get("task_id"):
            tasks = tasks.filter(id=params["task_id"])
        if params.get("search"):
            tasks = tasks.filter(name__icontains=params["search"])
        tasks = list(tasks.order_by("-created_at").prefetch_related("evals")[:HISTORY_SCAN])
        # A run knows its own unit; a question may have been asked of another.
        run_units = dict(
            InstantEvalRun.objects.filter(eval_task_id__in=[t.id for t in tasks])
            .values_list("eval_task_id", "unit")
        )
        runs = []
        for task in tasks:
            # In the order the run asked them (its page opens on the first).
            metas = [
                (str(c.id), (c.config or {}).get("instant_eval") or {})
                for c in asked_order(task, list(task.evals.all()))
            ]
            metas = [(cid, m) for cid, m in metas if m.get("question")]
            if not metas:
                continue
            unit = (
                run_units.get(task.id)
                or metas[0][1].get("unit")
                or str(task.row_type or "traces")
            )
            if params.get("unit") and unit != params["unit"]:
                continue
            runs.append((task, unit, metas))
        start = params["page_number"] * params["page_size"]
        page = runs[start : start + params["page_size"]]
        tids = [str(t.id) for t, _, _ in page]
        instant_runs = {
            str(r.eval_task_id): r
            for r in InstantEvalRun.objects.filter(eval_task_id__in=tids).select_related(
                "created_by"
            )
        }
        tally = _history_tally(
            [(t, instant_runs.get(str(t.id)), [cid for cid, _ in m]) for t, _, m in page]
        )
        out = []
        for task, unit, metas in page:
            tid = str(task.id)
            seen, settled, last_update, counts, stored, sessions = tally.get(
                tid, (0, 0, None, {}, 0, None)
            )
            run = instant_runs.get(tid)
            # Rows the task named (or its run picked) but hasn't logged yet are
            # pending too; a task that ran on filters only knows what it logged.
            named = len(_task_ids(task, unit)) or stored or seen
            if run is not None and not stored and task.status in ("pending", "running"):
                named = run.rows_requested
            pending = max(0, max(named, seen) - settled)
            if run is not None and run.cancelled_at:
                pending = 0
            out.append({
                "task_id": tid,
                "name": task.name or "",
                "created_at": _iso(task.created_at),
                "status": _history_status(task, run, pending),
                "run_type": str(task.run_type),
                "unit": unit,
                "reads": metas[0][1].get("reads"),
                "rows": stored or _task_rows(task),
                "config_ids": [cid for cid, _ in metas],
                "questions": [m["question"] for _, m in metas],
                "counts": counts,
                "answered": settled,
                "pending": pending,
                "finished_at": _iso(last_update) if not pending else None,
                "created_by": (run.created_by.name or run.created_by.email)
                if run is not None and run.created_by
                else None,
                "credits_estimate": run.credits_estimate if run is not None else None,
                "population": run.population if run is not None else None,
                "is_sample": bool(run is not None and run.rows_requested < run.population),
                "date_preset": run.date_preset if run is not None else None,
                "label": run.label if run is not None else None,
                "window": {"from": _iso(run.date_from), "to": _iso(run.date_to)}
                if run is not None and run.date_from
                else None,
                "sessions": sessions,
            })
        return self._gm.success_response(
            {"runs": out, "has_more": start + params["page_size"] < len(runs)}
        )
