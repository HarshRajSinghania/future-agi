"""
Instant eval at any size: from a view of 100 rows to one of 100,000.

POST /tracer/instant-eval/estimate/  how many rows a view holds and what reading
                                     a sample or all of them would cost
POST /tracer/instant-eval/start/     start a run over a view (or rows handed over)
GET  /tracer/instant-eval/summary/   everything the charts draw, as counts
GET  /tracer/instant-eval/rows/      one page of rows, filtered like the charts
GET  /tracer/instant-eval/export/    every row the filter selects, as CSV
POST /tracer/instant-eval/control/   pause, resume, cancel, retry the failed
                                     rows, or read more of a sample

The server resolves a view's rows itself (``tracer.services.instant_eval_rows``)
instead of taking ids from the browser, reads a deterministic hash-ordered
sample of it when asked to, and keeps every row's facets in a table so the
summary and rows endpoints aggregate in SQL
(``tracer.services.instant_eval_summary``). Every read is scoped to a project
of the caller's organization.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from datetime import UTC, datetime, timedelta

import structlog
from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import F
from django.http import StreamingHttpResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.gzip import gzip_page
from drf_yasg import openapi
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tfc.utils.api_contracts import validated_request
from tfc.utils.api_serializers import ApiErrorResponseSerializer
from tfc.utils.general_methods import GeneralMethods
from tracer.models.custom_eval_config import CustomEvalConfig
from tracer.models.eval_task import (
    RESUMABLE_TASK_STATUSES,
    EvalTask,
    EvalTaskStatus,
    RunType,
)
from tracer.models.instant_eval import InstantEvalRow, InstantEvalRun
from tracer.models.observation_span import EvalEntryStatus, EvalLogger
from tracer.serializers.filters import SessionFilterListField
from tracer.services import instant_eval_rows as rows_service
from tracer.services import instant_eval_summary as summary_service
from tracer.views.instant_eval import (
    INSTANT_TASK_PREFIX,
    MAX_ANSWER_ROWS,
    _iso,
    _org,
    _project,
    _task_ids,
    asked_order,
)

logger = structlog.get_logger(__name__)

UNITS = ["traces", "spans", "sessions", "users"]
CREDITS_PER_ANSWER = 0.06
SAMPLE_SIZES = (500, 1000, 2000, 5000)
DEFAULT_SAMPLE = 1000
MAX_HANDOVER_IDS = 5000
MAX_QUESTIONS = 5
MAX_PAGE_SIZE = 200
MAX_COMPACT_PAGE = 1500
SUMMARY_CACHE_TTL = 3600
TERMINAL = {EvalTaskStatus.COMPLETED, EvalTaskStatus.FAILED, EvalTaskStatus.PAUSED}
ACTIVE = (EvalTaskStatus.PENDING, EvalTaskStatus.RUNNING)


def max_rows() -> int:
    return int(getattr(settings, "INSTANT_EVAL_MAX_ROWS", 100_000))


def confirm_rows() -> int:
    return int(getattr(settings, "INSTANT_EVAL_CONFIRM_ROWS", 5_000))


def max_active() -> int:
    return int(getattr(settings, "INSTANT_EVAL_MAX_ACTIVE_PER_ORG", 2))


def answers_per_minute() -> float:
    # What a run is assumed to drain at; the summary reports the real rate
    # once answers land.
    return float(getattr(settings, "INSTANT_EVAL_ASSUMED_ROWS_PER_MIN", 300))


ERRORS = {
    400: ApiErrorResponseSerializer,
    403: ApiErrorResponseSerializer,
    404: ApiErrorResponseSerializer,
    500: ApiErrorResponseSerializer,
    503: ApiErrorResponseSerializer,
}


class InstantEvalBusyRunSerializer(serializers.Serializer):
    task_id = serializers.CharField()
    project_id = serializers.CharField()
    question = serializers.CharField(allow_blank=True)
    rows = serializers.IntegerField()
    started_by = serializers.CharField(allow_blank=True)
    started_at = serializers.CharField(allow_null=True)


class InstantEvalLimitDetailSerializer(serializers.Serializer):
    message = serializers.CharField()
    error_code = serializers.CharField()
    # A run waiting for its confirm: what it would read and cost.
    rows_to_read = serializers.IntegerField(required=False)
    credits_estimate = serializers.FloatField(required=False)
    # Refused for credits: what is left, and the largest sample that fits.
    credits_left = serializers.FloatField(required=False, allow_null=True)
    sample_size = serializers.IntegerField(required=False, allow_null=True)
    # The organization's runs in flight, when it is at its limit.
    runs = InstantEvalBusyRunSerializer(many=True, required=False)


class InstantEvalLimitErrorSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=False)
    type = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    code = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    detail = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    message = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    error = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    result = InstantEvalLimitDetailSerializer(required=False)


LIMIT_ERRORS = {
    **ERRORS,
    402: InstantEvalLimitErrorSerializer,
    403: InstantEvalLimitErrorSerializer,
    409: InstantEvalLimitErrorSerializer,
    422: ApiErrorResponseSerializer,
    429: InstantEvalLimitErrorSerializer,
}


# ─── Serializers ─────────────────────────────────────────────────────────────
class InstantEvalScopeSerializer(serializers.Serializer):
    project_id = serializers.UUIDField()
    unit = serializers.ChoiceField(choices=UNITS)
    # The view's filters, as its grid sends them (the window included). The
    # session list's filter contract is the widest of the grids'.
    filters = SessionFilterListField(required=False, default=list)
    # Rows handed over by id (a selection, an Insights category).
    ids = serializers.ListField(
        child=serializers.CharField(max_length=255),
        required=False,
        max_length=MAX_HANDOVER_IDS,
    )
    # None (or absent) reads every row of the view.
    sample_size = serializers.IntegerField(min_value=1, required=False, allow_null=True)


class InstantEvalEstimateRequestSerializer(InstantEvalScopeSerializer):
    questions = serializers.IntegerField(
        min_value=1, max_value=MAX_QUESTIONS, required=False, default=1
    )


class InstantEvalChoiceSerializer(serializers.Serializer):
    sample_size = serializers.IntegerField(allow_null=True)
    rows_to_read = serializers.IntegerField()
    credits_estimate = serializers.FloatField()
    seconds_estimate = serializers.IntegerField()
    needs_confirm = serializers.BooleanField()
    allowed = serializers.BooleanField()
    # More credits than the organization has left, or billing stops runs.
    credit_limited = serializers.BooleanField()


class InstantEvalCreditCheckSerializer(serializers.Serializer):
    # Whether the chosen size (at the questions asked) can start.
    allowed = serializers.BooleanField()
    # FREE_TIER_LIMIT, BUDGET_PAUSED, PAYMENT_REQUIRED, ... when not allowed.
    error_code = serializers.CharField(allow_null=True)
    current_usage = serializers.FloatField(allow_null=True)
    limit = serializers.FloatField(allow_null=True)
    # Credits left this month, or None when no cap this view can reach.
    credits_left = serializers.FloatField(allow_null=True)
    # A paused budget or an unpaid invoice: no run can start.
    blocked = serializers.BooleanField()
    message = serializers.CharField(allow_null=True)


class InstantEvalEstimateSerializer(serializers.Serializer):
    population = serializers.IntegerField()
    population_is_lower_bound = serializers.BooleanField()
    rows_to_read = serializers.IntegerField()
    questions = serializers.IntegerField()
    credits_estimate = serializers.FloatField()
    seconds_estimate = serializers.IntegerField()
    needs_confirm = serializers.BooleanField()
    max_rows = serializers.IntegerField()
    confirm_rows = serializers.IntegerField()
    default_sample_size = serializers.IntegerField(allow_null=True)
    # Sessions read per user, for a user question.
    sessions_per_user = serializers.IntegerField(allow_null=True)
    choices = InstantEvalChoiceSerializer(many=True)
    # The organization's credit cap against the chosen size, and the
    # largest sample (in the view's unit) its credits left pay for.
    credit_check = InstantEvalCreditCheckSerializer()
    credit_max_sample = serializers.IntegerField(allow_null=True)


class InstantEvalEstimateResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = InstantEvalEstimateSerializer()


class InstantEvalStartRequestSerializer(InstantEvalScopeSerializer):
    config_ids = serializers.ListField(
        child=serializers.UUIDField(), min_length=1, max_length=MAX_QUESTIONS
    )
    confirm = serializers.BooleanField(required=False, default=False)


class InstantEvalStartSerializer(serializers.Serializer):
    task_id = serializers.CharField()
    unit = serializers.CharField()
    population = serializers.IntegerField()
    rows_requested = serializers.IntegerField()
    is_sample = serializers.BooleanField()
    credits_estimate = serializers.FloatField()


class InstantEvalStartResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = InstantEvalStartSerializer()


class InstantEvalRunQuerySerializer(serializers.Serializer):
    project_id = serializers.UUIDField()
    eval_task_id = serializers.UUIDField()
    unit = serializers.ChoiceField(choices=UNITS, required=False)
    config_ids = serializers.CharField(
        max_length=2000, required=False, allow_blank=True
    )
    # The viewer's IANA time zone: every time bucket is local to it.
    tz = serializers.CharField(max_length=64, required=False, default="UTC")


class InstantEvalRowsQuerySerializer(InstantEvalRunQuerySerializer):
    config_id = serializers.UUIDField(required=False)
    answer = serializers.CharField(max_length=500, required=False)
    # [{"config_id", "answer"}, ...] as JSON: every one must hold.
    answers = serializers.CharField(max_length=4000, required=False)
    time_from = serializers.CharField(max_length=64, required=False)
    time_to = serializers.CharField(max_length=64, required=False)
    # "<dim>:<key>"; repeat it (or join with ",") for any of several groups.
    group = serializers.ListField(
        child=serializers.CharField(max_length=300), required=False, max_length=50
    )
    user = serializers.CharField(max_length=255, required=False)
    model = serializers.CharField(max_length=255, required=False)
    error = serializers.BooleanField(required=False, allow_null=True, default=None)
    unsure = serializers.BooleanField(required=False, default=False)
    q = serializers.CharField(max_length=200, required=False, allow_blank=True)
    cursor = serializers.CharField(max_length=500, required=False, allow_blank=True)
    page_size = serializers.IntegerField(
        min_value=1, max_value=MAX_COMPACT_PAGE, required=False, default=50
    )
    # Rows for the charts' squares: up to 1,500 a page, without explanations.
    compact = serializers.BooleanField(required=False, default=False)
    sort = serializers.ChoiceField(
        choices=["time", "-time", "confidence"], required=False, default="-time"
    )


class InstantEvalQuestionSerializer(serializers.Serializer):
    config_id = serializers.CharField()
    question = serializers.CharField(allow_blank=True)
    answer_type = serializers.CharField()
    labels = serializers.ListField(child=serializers.CharField())


class InstantEvalPersonSerializer(serializers.Serializer):
    id = serializers.CharField()
    name = serializers.CharField(allow_blank=True)
    email = serializers.CharField(allow_blank=True)


class InstantEvalSampleSerializer(serializers.Serializer):
    population = serializers.IntegerField()
    population_is_lower_bound = serializers.BooleanField()
    requested = serializers.IntegerField()
    read = serializers.IntegerField()
    is_sample = serializers.BooleanField()
    can_extend = serializers.BooleanField()
    next_size = serializers.IntegerField()


class InstantEvalSummarySerializer(serializers.Serializer):
    status = serializers.CharField()
    unit = serializers.CharField()
    preparing = serializers.BooleanField()
    total = serializers.IntegerField()
    answered = serializers.IntegerField()
    failed = serializers.IntegerField()
    pending = serializers.IntegerField()
    not_read = serializers.IntegerField()
    started_at = serializers.CharField(allow_null=True)
    finished_at = serializers.CharField(allow_null=True)
    rate_per_min = serializers.FloatField(allow_null=True)
    eta_s = serializers.IntegerField(allow_null=True)
    created_by = InstantEvalPersonSerializer(allow_null=True)
    credits_estimate = serializers.FloatField()
    # What the answers given so far cost (a failed answer isn't billed).
    credits_used = serializers.FloatField()
    # Paused, with this many answers still being read (they will land).
    in_flight = serializers.IntegerField(allow_null=True)
    # Running, but no answer has landed for this many seconds (two minutes
    # or more): the workers are busy elsewhere, or coming back.
    waiting_s = serializers.IntegerField(allow_null=True)
    # How long the run actually answered (minutes in which answers landed),
    # and how long it sat paused or stopped since it started.
    active_s = serializers.IntegerField(allow_null=True)
    idle_s = serializers.IntegerField(allow_null=True)
    sample = InstantEvalSampleSerializer()
    window = serializers.JSONField()
    scope = serializers.JSONField()
    questions = InstantEvalQuestionSerializer(many=True)
    counts = serializers.JSONField()
    unsure = serializers.JSONField()
    timeline = serializers.JSONField()
    groups = serializers.JSONField()
    cross = serializers.JSONField()


class InstantEvalSummaryResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = InstantEvalSummarySerializer()


class InstantEvalRowsResultSerializer(serializers.Serializer):
    rows = serializers.ListField(child=serializers.JSONField())
    next_cursor = serializers.CharField(allow_null=True)
    total = serializers.IntegerField()


class InstantEvalRowsResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = InstantEvalRowsResultSerializer()


class InstantEvalControlRequestSerializer(serializers.Serializer):
    project_id = serializers.UUIDField()
    eval_task_id = serializers.UUIDField()
    action = serializers.ChoiceField(
        choices=["pause", "resume", "cancel", "retry_failed", "read_more"]
    )
    # read_more: how many more rows; absent or null reads the rest of the view.
    more = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    confirm = serializers.BooleanField(required=False, default=False)


class InstantEvalControlSerializer(serializers.Serializer):
    status = serializers.CharField()
    message = serializers.CharField()
    rows_requested = serializers.IntegerField(required=False)
    retried = serializers.IntegerField(required=False)


class InstantEvalControlResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = InstantEvalControlSerializer()


# ─── Helpers ─────────────────────────────────────────────────────────────────
def _credits(rows: int, questions: int) -> float:
    return round(rows * questions * CREDITS_PER_ANSWER, 2)


# Billing's event for a Jev answer; its cap is the organization's credits.
CREDIT_EVENT = "jev_evaluator"
# Credit refusals that no smaller run gets past.
CREDIT_MESSAGES = {
    "BUDGET_PAUSED": (
        "Jev runs are paused by your budget limit. Raise or remove it in "
        "billing to run this."
    ),
    "PAYMENT_REQUIRED": (
        "Your subscription has unpaid invoices. Update your payment method "
        "in billing to run this."
    ),
}


def check_credits(org, credits: float):
    """The organization's credit cap against a run costing ``credits``:
    None when it may run (or this deployment has no billing), else billing's
    CheckResult. Read-only."""
    if org is None or credits <= 0:
        return None
    try:
        from ee.usage.services.metering import check_usage
    except ImportError:
        return None
    try:
        result = check_usage(str(org.id), CREDIT_EVENT, amount=credits)
    except Exception:
        # No billing config (or its Redis) here: don't block the run.
        logger.warning("instant_eval_credit_check_unavailable", exc_info=True)
        return None
    return None if result.allowed else result


def _credits_left(*results) -> float | None:
    """Credits left this month, from whichever refusal reported the cap."""
    for result in results:
        if result is not None and result.error_code == "FREE_TIER_LIMIT":
            return max(0.0, float(result.limit or 0) - float(result.current_usage or 0))
    return None


def _blocked(*results) -> bool:
    """Billing stops every run: a paused budget, an unpaid invoice."""
    return any(
        result is not None and result.error_code not in ("", "FREE_TIER_LIMIT")
        for result in results
    )


def _fits(left: float | None, unit: str, questions: int, population: int) -> int | None:
    """The largest sample, in the view's unit, that ``left`` credits pay for."""
    if left is None:
        return None
    per_unit = _rows_for(unit, 1) * max(1, questions) * CREDITS_PER_ANSWER
    return min(population, int((left + 1e-9) // per_unit))


def _amount(credits: float) -> str:
    """Credits as people read them, as the Ask page prints them: whole from
    10 up, else to a tenth ("0.7")."""
    if credits >= 10:
        return f"{credits:,.0f}"
    return f"{credits:.1f}".rstrip("0").rstrip(".")


def _credit_count(credits: float) -> str:
    """Credits with their noun: "120 credits", "0.7 credits", "1 credit"."""
    amount = _amount(credits)
    return f"{amount} credit{'' if amount == '1' else 's'}"


def _credit_message(result, credits: float, left: float | None, fits, unit) -> str:
    if result.error_code == "FREE_TIER_LIMIT" and left is not None:
        have = f"you have {_amount(left)}" if left >= 0.05 else "you have none"
        message = (
            f"This run needs about {_credit_count(credits)}; {have} left this month."
        )
        if fits:
            return f"{message} A sample of up to {fits:,} {unit} fits."
        return f"{message} Upgrade your plan in billing to run it."
    return CREDIT_MESSAGES.get(result.error_code) or (
        result.reason or "Your plan doesn't allow this run right now."
    )


def _credit_refusal(gm, refused, credits, unit, questions, population):
    """Billing refused a run costing ``credits``: why, and the largest
    sample of ``population`` that fits what is left."""
    left = _credits_left(refused)
    fits = None if _blocked(refused) else _fits(left, unit, questions, population)
    return gm.custom_error_response(
        402 if refused.error_code == "PAYMENT_REQUIRED" else 403,
        {
            "message": _credit_message(refused, credits, left, fits, unit),
            "error_code": refused.error_code or "INSTANT_EVAL_CREDITS",
            "credits_estimate": credits,
            "credits_left": left,
            "sample_size": fits or None,
            "rows_to_read": _rows_for(unit, fits) if fits else 0,
        },
        code="instant_eval_credits",
    )


def _seconds(rows: int, questions: int) -> int:
    return int(math.ceil(10 + rows * questions / answers_per_minute() * 60))


def _rows_for(unit: str, users_or_rows: int) -> int:
    """The rows a run reads: a user question reads up to five sessions each."""
    return users_or_rows * (rows_service.SESSIONS_PER_USER if unit == "users" else 1)


def _choice(
    unit: str,
    population: int,
    size: int | None,
    questions: int,
    left: float | None = None,
    blocked: bool = False,
) -> dict:
    count = population if size is None else min(size, population)
    rows = _rows_for(unit, count)
    credits = _credits(rows, questions)
    limited = blocked or (left is not None and credits > left + 1e-9)
    return {
        "sample_size": size,
        "rows_to_read": rows,
        "credits_estimate": credits,
        "seconds_estimate": _seconds(rows, questions),
        "needs_confirm": rows > confirm_rows(),
        "allowed": 0 < rows <= max_rows() and not limited,
        "credit_limited": limited,
    }


def _person(user) -> dict | None:
    if user is None:
        return None
    return {"id": str(user.id), "name": user.name or "", "email": user.email or ""}


def _question(config) -> dict:
    meta = (config.config or {}).get("instant_eval") or {}
    answer_type = meta.get("answer_type") or "yes_no"
    labels = list(
        meta.get("labels") or (["Yes", "No"] if answer_type == "yes_no" else [])
    )
    return {
        "config_id": str(config.id),
        "question": meta.get("question") or config.name or "",
        "answer_type": "category" if answer_type == "category" else "yes_no",
        "labels": labels,
    }


def _active_runs(org):
    return list(
        InstantEvalRun.objects.filter(
            organization=org,
            cancelled_at__isnull=True,
            eval_task__deleted=False,
            eval_task__status__in=ACTIVE,
        )
        .select_related("eval_task", "created_by")
        .order_by("created_at")
    )


def _busy_response(gm, runs):
    """429 naming the runs already in flight."""
    described = []
    for run in runs:
        name = (run.eval_task.name or "").removeprefix(f"{INSTANT_TASK_PREFIX} · ")
        who = run.created_by.name if run.created_by else "someone"
        described.append(
            {
                "task_id": str(run.eval_task_id),
                "project_id": str(run.project_id),
                "question": name,
                "rows": run.rows_requested,
                "started_by": who,
                "started_at": _iso(run.created_at),
            }
        )
    names = "; ".join(
        f"“{d['question']}” ({d['rows']:,} rows, started by {d['started_by']})"
        for d in described
    )
    message = (
        f"Your organization already has {len(runs)} Instant eval "
        f"run{'s' if len(runs) != 1 else ''} in progress, the most it runs at once: {names}. "
        "Pause or cancel one, or wait for it to finish."
    )
    return gm.custom_error_response(
        429,
        {"message": message, "error_code": "INSTANT_EVAL_BUSY", "runs": described},
        code="instant_eval_busy",
    )


def _start_workflow_on_commit(task, *, replace: bool) -> None:
    from tfc.temporal.eval_tasks.client import start_eval_task_workflow_sync

    def start():
        try:
            start_eval_task_workflow_sync(task, replace_existing=replace)
        except Exception:
            logger.exception("instant_eval_workflow_start_failed", task_id=str(task.id))
            EvalTask.objects.filter(id=task.id).update(status=EvalTaskStatus.FAILED)

    transaction.on_commit(start)


def _resolve_scope(
    request, data
) -> tuple[int, bool, rows_service.Population | None, list[str] | None]:
    """The view's population: the handed-over ids, or the grid's own count."""
    from tracer.services.filter_principal_context import (
        bind_request_my_annotations_principal,
    )

    ids = data.get("ids")
    if ids:
        ids = list(dict.fromkeys(str(i) for i in ids if i))
        return len(ids), False, None, ids
    filters = bind_request_my_annotations_principal(
        request, list(data.get("filters") or [])
    )
    population = rows_service.count_population(
        str(data["project_id"]), data["unit"], filters
    )
    return population.count, population.lower_bound, population, None


# ─── Estimate ────────────────────────────────────────────────────────────────
class InstantEvalEstimateView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        request_serializer=InstantEvalEstimateRequestSerializer,
        responses={
            200: InstantEvalEstimateResponseSerializer,
            422: ApiErrorResponseSerializer,
            **ERRORS,
        },
    )
    def post(self, request):
        """How many rows a view holds, and what a sample or all of it costs."""
        data = request.validated_data
        project = _project(request, data["project_id"])
        if project is None:
            return self._gm.not_found("Project not found")
        unit = data["unit"]
        try:
            count, lower, _, ids = _resolve_scope(request, data)
        except rows_service.PopulationUnavailable as exc:
            return self._gm.custom_error_response(
                422, str(exc), code="population_unavailable"
            )
        except Exception:
            logger.exception("instant_eval_estimate_failed")
            return self._gm.custom_error_response(
                503, "The view can't be counted right now. Please retry."
            )
        questions = data.get("questions") or 1
        size = data.get("sample_size")
        org = _org(request)
        chosen_rows = _rows_for(unit, count if size is None else min(size, count))
        chosen_credits = _credits(chosen_rows, questions)
        # The chosen run, and the most the composer can ask (every row, every
        # question): a refusal of either reports the cap, so each choice and
        # any number of questions can be judged from it.
        refused = check_credits(org, chosen_credits)
        ceiling = check_credits(org, _credits(_rows_for(unit, count), MAX_QUESTIONS))
        left = _credits_left(refused, ceiling)
        blocked = _blocked(refused, ceiling)
        fits = None if blocked else _fits(left, unit, questions, count)
        default = DEFAULT_SAMPLE if count > DEFAULT_SAMPLE and not ids else None
        sizes = [s for s in SAMPLE_SIZES if s < count] if not ids else []
        choices = [_choice(unit, count, s, questions, left, blocked) for s in sizes] + [
            _choice(unit, count, None, questions, left, blocked)
        ]
        chosen = _choice(unit, count, size, questions, left, blocked)
        reported = refused or ceiling
        credit_check = {
            "allowed": refused is None,
            "error_code": refused.error_code if refused else None,
            "current_usage": getattr(reported, "current_usage", None),
            "limit": getattr(reported, "limit", None),
            "credits_left": left,
            "blocked": blocked,
            "message": (
                _credit_message(refused, chosen_credits, left, fits, unit)
                if refused
                else None
            ),
        }
        return self._gm.success_response(
            {
                "population": count,
                "population_is_lower_bound": lower,
                "rows_to_read": chosen["rows_to_read"],
                "questions": questions,
                "credits_estimate": chosen["credits_estimate"],
                "seconds_estimate": chosen["seconds_estimate"],
                "needs_confirm": chosen["needs_confirm"],
                "max_rows": max_rows(),
                "confirm_rows": confirm_rows(),
                "default_sample_size": default,
                "sessions_per_user": rows_service.SESSIONS_PER_USER
                if unit == "users"
                else None,
                "choices": choices,
                "credit_check": credit_check,
                "credit_max_sample": fits,
            }
        )


# ─── Start ───────────────────────────────────────────────────────────────────
class InstantEvalStartView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        request_serializer=InstantEvalStartRequestSerializer,
        responses={200: InstantEvalStartResponseSerializer, **LIMIT_ERRORS},
    )
    def post(self, request):
        """Start a run: the server resolves the view's rows (or reads the rows
        handed over), enforces the size and concurrency limits, and starts the
        eval task. The rows are picked by the task's first step."""
        data = request.validated_data
        project = _project(request, data["project_id"])
        if project is None:
            return self._gm.not_found("Project not found")
        org = _org(request)
        unit = data["unit"]
        wanted = [str(c) for c in data["config_ids"]]
        configs = {
            str(c.id): c
            for c in CustomEvalConfig.objects.filter(
                id__in=wanted, project=project, deleted=False
            )
        }
        if len(configs) != len(set(wanted)) or not all(
            (c.config or {}).get("instant_eval") for c in configs.values()
        ):
            return self._gm.bad_request("Those questions aren't saved in this project.")
        active = _active_runs(org)
        if len(active) >= max_active():
            return _busy_response(self._gm, active)
        try:
            count, lower, population, ids = _resolve_scope(request, data)
        except rows_service.PopulationUnavailable as exc:
            return self._gm.custom_error_response(
                422, str(exc), code="population_unavailable"
            )
        except Exception:
            logger.exception("instant_eval_start_count_failed")
            return self._gm.custom_error_response(
                503, "The view can't be read right now. Please retry."
            )
        size = None if ids else data.get("sample_size")
        requested = count if size is None else min(size, count)
        questions = len(wanted)
        rows = _rows_for(unit, requested)
        if requested <= 0:
            return self._gm.bad_request(
                f"There are no {unit} in this view to ask about."
            )
        if rows > max_rows():
            return self._gm.custom_error_response(
                400,
                f"A run reads at most {max_rows():,} rows and this one would read {rows:,}. "
                "Read a sample, or narrow the view.",
                code="instant_eval_too_large",
            )
        credits = _credits(rows, questions)
        refused = check_credits(org, credits)
        if refused is not None:
            return _credit_refusal(self._gm, refused, credits, unit, questions, count)
        if rows > confirm_rows() and not data.get("confirm"):
            return self._gm.custom_error_response(
                409,
                {
                    "message": f"Reading {rows:,} rows costs about {credits:,.0f} credits. Confirm to start.",
                    "error_code": "INSTANT_EVAL_CONFIRM",
                    "rows_to_read": rows,
                    "credits_estimate": credits,
                },
                code="confirm_required",
            )
        ordered = [configs[c] for c in dict.fromkeys(wanted)]
        first = _question(ordered[0])["question"]
        filters = {
            "project_id": str(project.id),
            rows_service.RUN_MARKER: True,
            # The questions in the order they were asked.
            "instant_config_ids": [str(c.id) for c in ordered],
        }
        if ids:
            filters["instant_ids"] = ids
        with transaction.atomic():
            task = EvalTask.objects.create(
                project=project,
                name=f"{INSTANT_TASK_PREFIX} · {first}"[:255],
                filters=filters,
                sampling_rate=100,
                spans_limit=rows,
                run_type=RunType.HISTORICAL,
                row_type=rows_service.ROW_TYPE[unit],
                status=EvalTaskStatus.PENDING,
                last_run=timezone.now(),
            )
            task.evals.set(ordered)
            InstantEvalRun.objects.create(
                eval_task=task,
                project=project,
                organization=org,
                created_by=request.user if request.user.is_authenticated else None,
                unit=unit,
                row_type=rows_service.ROW_TYPE[unit],
                filters=population.filters if population else [],
                date_from=population.date_from if population else None,
                date_to=population.date_to if population else None,
                population=count,
                population_is_lower_bound=lower,
                sample_size=size,
                rows_requested=requested,
                questions=questions,
                credits_estimate=credits,
                # Its answers are recorded as they land.
                answers_synced=True,
            )
            _start_workflow_on_commit(task, replace=False)
        return self._gm.success_response(
            {
                "task_id": str(task.id),
                "unit": unit,
                "population": count,
                "rows_requested": requested,
                "is_sample": requested < count,
                "credits_estimate": credits,
            }
        )


# ─── Reading a run ───────────────────────────────────────────────────────────
def _load(request, params, gm):
    project = _project(request, params["project_id"])
    if project is None:
        return None, gm.not_found("Project not found")
    task = (
        EvalTask.objects.filter(
            id=params["eval_task_id"], project=project, deleted=False
        )
        .prefetch_related("evals")
        .first()
    )
    if task is None:
        return None, gm.not_found("Eval task not found")
    return task, None


def _run_of(task):
    return (
        InstantEvalRun.objects.filter(eval_task=task)
        .select_related("created_by")
        .first()
    )


def _unit_of(task, run, params) -> str:
    if run is not None:
        return run.unit
    for config in task.evals.all():
        unit = ((config.config or {}).get("instant_eval") or {}).get("unit")
        if unit:
            return unit
    return params.get("unit") or str(task.row_type or "traces")


def _view(task, run, params) -> tuple[summary_service.RunView, list[dict]]:
    configs = [
        c for c in task.evals.all() if (c.config or {}).get("instant_eval")
    ] or list(task.evals.all())
    wanted = [c for c in (params.get("config_ids") or "").split(",") if c][
        :MAX_QUESTIONS
    ]
    by_id = {str(c.id): c for c in configs}
    ordered = [by_id[c] for c in wanted if c in by_id] or asked_order(task, configs)[
        :MAX_QUESTIONS
    ]
    questions = [_question(c) for c in ordered]
    unit = _unit_of(task, run, params)
    view = summary_service.RunView(
        task_id=str(task.id),
        row_type=rows_service.ROW_TYPE.get(unit, "traces"),
        unit=unit,
        config_ids=[q["config_id"] for q in questions],
        tz=summary_service.zone(params.get("tz")),
        date_from=run.date_from if run else None,
        date_to=run.date_to if run else None,
        cancelled=bool(run and run.cancelled_at),
        labels={q["config_id"]: q["labels"] for q in questions},
        # A user question stores each user's sessions, so its rows can't be
        # told complete from the users it asked for.
        rows_expected=run.rows_requested if run and unit != "users" else None,
        rows_version=run.answers_version if run else 0,
        live=_status(task, run) in ACTIVE,
    )
    return view, questions


def ensure_rows(task, unit: str) -> None:
    """A run started before rows were stored (or by the plain eval-task API)
    gets them on its first read: the ids it named, or the rows it answered."""
    if InstantEvalRow.objects.filter(task_id=task.id).exists():
        return
    row_type = rows_service.ROW_TYPE.get(unit, "traces")
    ids = _task_ids(task, unit)
    if not ids:
        key = {"traces": "trace_id", "spans": "observation_span_id"}.get(
            row_type, "trace_session_id"
        )
        ids = [
            str(v)
            for v in EvalLogger.objects.filter(eval_task_id=str(task.id), deleted=False)
            .exclude(**{f"{key}__isnull": True})
            .order_by()
            .values_list(key, flat=True)
            .distinct()[:MAX_ANSWER_ROWS]
        ]
    if not ids:
        return
    facets = rows_service.read_facets(str(task.project_id), row_type, ids)
    rows_service.write_rows(
        task.id, unit, [(rid, i) for i, rid in enumerate(ids)], facets
    )


# Every poll of a live run shares one count for this long, however many
# people (or tabs) watch it; only one request counts at a time.
LIVE_SNAPSHOT_S = 2.5
# A run that has landed no answer for this long while its task says it is
# running is checked for a workflow that is gone.
STALL_AFTER_S = 90
STALL_CHECK_TTL = 20
STALLED = "stalled"
# Paused, while the answers already being read still land.
PAUSING = "pausing"
# A running run that has landed nothing for this long says it is waiting.
WAITING_AFTER_S = 120
# An eval claimed (or started) longer ago than this is no longer in flight.
IN_FLIGHT_S = 300


def _live_summary_age(rows: int) -> float:
    """How stale a live run's summary may get: a few seconds, and a second
    per 20,000 rows past that (5 s at 100,000)."""
    return max(LIVE_SNAPSHOT_S, rows / 20_000)


def _status(task, run) -> str:
    if run is not None and run.cancelled_at:
        return "cancelled"
    return str(task.status or EvalTaskStatus.PENDING)


def _workflow_gone(task) -> bool:
    """Whether no Temporal workflow is draining the task (a restart or a
    crash took it), asked at most every 20 s per task. An unreachable
    Temporal is not an answer: the run is then taken to be running."""
    from tfc.temporal.eval_tasks.client import (
        WF_ABSENT,
        WF_CLOSED,
        describe_eval_task_workflow_sync,
    )

    key = f"ie-wf-gone:{task.id}"
    known = cache.get(key)
    if known is not None:
        return known
    try:
        gone = describe_eval_task_workflow_sync(task.id) in (WF_ABSENT, WF_CLOSED)
    except Exception:
        logger.warning("instant_eval_describe_failed", task_id=str(task.id))
        gone = False
    cache.set(key, gone, STALL_CHECK_TTL)
    return gone


def _run_time(run, progress: dict, running: bool) -> dict:
    """Active time (a minute per minute in which answers landed) and idle
    time (the rest of the wall time since the run started)."""
    if not progress.get("active_minutes") or not run.created_at:
        return {"active_s": None, "idle_s": None}
    end_ms = time.time() * 1000 if running else (progress["last_ms"] or 0)
    wall = max(0, (end_ms - run.created_at.timestamp() * 1000) / 1000)
    active = min(wall, progress["active_minutes"] * 60)
    return {"active_s": round(active), "idle_s": round(max(0, wall - active))}


def _in_flight(task) -> int:
    """Answers of a paused run still being read: running entries claimed or
    started in the last five minutes (older claims belong to a worker that
    is gone)."""
    from tracer.models.observation_span import EvalEntryStatus, EvalLogger

    return EvalLogger.objects.filter(
        eval_task_id=str(task.id),
        status=EvalEntryStatus.RUNNING,
        deleted=False,
        updated_at__gte=timezone.now() - timedelta(seconds=IN_FLIGHT_S),
    ).count()


def _stalled(task, status: str, data: dict, progress: dict) -> bool:
    """A run stopped before finishing: its task ended (or its workflow is
    gone) while rows still wait for an answer."""
    if not data["pending"] or data.get("preparing"):
        return False
    if status in (EvalTaskStatus.COMPLETED, EvalTaskStatus.FAILED):
        return True
    if status not in ACTIVE:
        return False
    now_ms = time.time() * 1000
    quiet_since = max(
        progress["last_ms"] or 0,
        task.updated_at.timestamp() * 1000 if task.updated_at else 0,
    )
    return now_ms - quiet_since > STALL_AFTER_S * 1000 and _workflow_gone(task)


def _prepared_run(task, params) -> InstantEvalRun:
    """The run record, its rows and their answers in place. A task asked
    before runs were recorded (or through the plain eval-task API) gets them
    on its first read."""
    run = _run_of(task)
    if run is None:
        unit = _unit_of(task, None, params)
        ensure_rows(task, unit)
        stored = InstantEvalRow.objects.filter(task_id=task.id).count()
        run, _ = InstantEvalRun.objects.get_or_create(
            eval_task=task,
            defaults={
                "project_id": task.project_id,
                "organization_id": task.project.organization_id,
                "unit": unit,
                "row_type": rows_service.ROW_TYPE.get(unit, "traces"),
                "population": stored,
                "rows_requested": stored,
                "questions": task.evals.count() or 1,
                "credits_estimate": _credits(stored, task.evals.count() or 1),
            },
        )
        run = _run_of(task)
    return run


def _ensure_answers(run) -> None:
    from tracer.services.instant_eval_answers import ensure_synced

    ensure_synced(run, check=False)


def _unanswered_rows(run) -> int:
    """Rows of a run still missing an answer to one of its questions."""
    from django.db import connection

    with connection.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM tracer_instant_eval_row r LEFT JOIN ("
            "SELECT row_id, count(*) AS c FROM tracer_instant_eval_answer "
            "WHERE task_id = %(task)s GROUP BY row_id) a ON a.row_id = r.id "
            "WHERE r.task_id = %(task)s AND COALESCE(a.c, 0) < %(k)s",
            {"task": str(run.eval_task_id), "k": max(1, run.questions)},
        )
        return int(cur.fetchone()[0])


def _summary_key(task, run, status: str, view) -> str:
    raw = (
        f"{task.id}:{status}:{run.answers_version}:{view.unit}:"
        f"{','.join(view.config_ids)}:{view.tz.key}"
    )
    return "ie-summary:v6:" + hashlib.sha1(raw.encode()).hexdigest()


def _summary_payload(task, run, view, questions) -> dict:
    data = summary_service.summary(view)
    progress = data.pop("_progress")
    status = _status(task, run)
    # Until the task's first step stores the rows, the run is all pending.
    preparing = status in ACTIVE and data.pop("rows_stored") == 0
    data.pop("rows_stored", None)
    requested = run.rows_requested
    if preparing:
        data.update(total=requested, pending=requested)
    data["preparing"] = preparing
    if _stalled(task, status, data, progress):
        status = STALLED
    in_flight = None
    if status == EvalTaskStatus.PAUSED:
        in_flight = _in_flight(task)
        if in_flight:
            status = PAUSING
    running = status in ACTIVE
    waiting_s = None
    if running and data["pending"] and not data.get("preparing"):
        # Quiet since the last answer, or since the run (re)started: a
        # resumed run isn't waiting for the hours it spent paused.
        started = task.start_time or run.created_at
        quiet_since = max(
            progress["last_ms"] or 0,
            started.timestamp() * 1000 if started else 0,
        )
        quiet = (time.time() * 1000 - quiet_since) / 1000 if quiet_since else 0
        waiting_s = int(quiet) if quiet >= WAITING_AFTER_S else None
    ncfg = max(1, len(view.config_ids))
    rate = None
    if running and progress["recent_entries"]:
        landing_s = (time.time() * 1000 - (progress["first_ms"] or 0)) / 1000
        window_s = min(summary_service.RATE_WINDOW_S, max(10.0, landing_s))
        rate = progress["recent_entries"] / ncfg / (window_s / 60)
    elif progress["settled_entries"] and progress["last_ms"] and progress["first_ms"]:
        minutes = max(1 / 60, (progress["last_ms"] - progress["first_ms"]) / 60000)
        rate = progress["settled_entries"] / ncfg / minutes
    pending = data["pending"]
    eta = int(pending / rate * 60) if running and rate and pending else None
    finished = (
        _iso(datetime.fromtimestamp(progress["last_ms"] / 1000, tz=UTC))
        if not running and progress["last_ms"]
        else None
    )
    population = run.population
    read = data["total"]
    is_sample = requested < population
    remaining = max(0, population - requested)
    next_size = min(remaining, run.sample_size or DEFAULT_SAMPLE) if is_sample else 0
    return {
        "status": status,
        "unit": view.unit,
        **data,
        "started_at": _iso(run.created_at),
        "finished_at": finished,
        **_run_time(run, progress, running),
        "rate_per_min": round(rate, 1) if rate else None,
        "eta_s": eta,
        "created_by": _person(run.created_by),
        "credits_estimate": run.credits_estimate,
        # What the answers Jev gave so far cost.
        "credits_used": round(progress["answers_given"] * CREDITS_PER_ANSWER, 2),
        "in_flight": in_flight,
        "waiting_s": waiting_s,
        "sample": {
            "population": population,
            "population_is_lower_bound": run.population_is_lower_bound,
            "requested": requested,
            "read": read,
            "is_sample": is_sample,
            "can_extend": is_sample and not running and status != "cancelled",
            "next_size": next_size,
        },
        "window": {
            "from": _iso(run.date_from) if run.date_from else None,
            "to": _iso(run.date_to) if run.date_to else None,
        },
        # What the run was asked about, so it can be asked again.
        "scope": {
            "filters": run.filters or [],
            "sample_size": run.sample_size,
            "ids": (task.filters or {}).get("instant_ids")
            or _task_ids(task, view.unit)
            or None,
        },
        "questions": questions,
    }


def _checked_key(run) -> str:
    return f"ie-answers-checked:{run.eval_task_id}:{run.answers_version}"


def compute_summary(task, run, view, questions) -> dict:
    """Count a run, copying its answers over first if they weren't recorded
    as they landed (or, once it has finished, if any were missed), and keep
    the result: for good once the run has finished."""
    from tracer.services.instant_eval_answers import ensure_synced

    status = _status(task, run)
    # Comparing a finished run's answers with the eval logger counts every
    # entry, so it is done once per answers version, not once per time zone.
    check = status in TERMINAL and not cache.get(_checked_key(run))
    ensure_synced(run, check=check)
    if check:
        cache.set(_checked_key(run), 1, None)
    payload = _summary_payload(task, run, view, questions)
    finished = payload["status"] not in (*ACTIVE, STALLED, PAUSING)
    cache.set(
        _summary_key(task, run, payload["status"], view),
        {"payload": payload, "at": time.time()},
        # A finished run never changes until something bumps its answers
        # version; a live or stalled one is counted again shortly.
        None if finished else 60,
    )
    return payload


def prewarm_summary(task_id) -> None:
    """Count a run that just finished in the time zone it was last viewed
    in, so whoever opens it next reads the count instead of waiting for it."""
    task = EvalTask.objects.filter(id=task_id).prefetch_related("evals").first()
    run = _run_of(task) if task else None
    if run is None:
        return
    view, questions = _view(task, run, {"tz": run.last_tz or "UTC"})
    compute_summary(task, run, view, questions)


# Hundreds of KB of counts every 2 s compress about tenfold.
@method_decorator(gzip_page, name="dispatch")
class InstantEvalSummaryView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        query_serializer=InstantEvalRunQuerySerializer,
        responses={200: InstantEvalSummaryResponseSerializer, **ERRORS},
    )
    def get(self, request):
        """Everything the Ask page's charts draw for one run, as counts:
        progress, answer totals, a timeline in the viewer's time zone, and the
        counts per day, hour, user, model, turns and error."""
        params = request.validated_query_data
        task, error = _load(request, params, self._gm)
        if error:
            return error
        try:
            run = _prepared_run(task, params)
            view, questions = _view(task, run, params)
        except summary_service.BadFilter as exc:
            return self._gm.bad_request(str(exc))
        except Exception:
            logger.exception(
                "instant_eval_summary_prepare_failed", task_id=str(task.id)
            )
            return self._gm.custom_error_response(
                503, "The run's answers can't be read right now. Please retry."
            )
        if run.last_tz != view.tz.key:
            InstantEvalRun.objects.filter(id=run.id).update(last_tz=view.tz.key)
        status = _status(task, run)
        live = status in ACTIVE
        # A finished run's summary never changes. A live run is counted again
        # at most every few seconds, shared by everyone watching it, so
        # polling costs one count per window, not one per poll.
        max_age = _live_summary_age(run.rows_requested) if live else None
        stale = None
        for kept in (status, STALLED):
            cached = cache.get(_summary_key(task, run, kept, view))
            if cached is None:
                continue
            age = time.time() - cached["at"]
            if kept == STALLED:
                fresh = age < STALL_CHECK_TTL
            else:
                fresh = not live or age < max_age
            if fresh:
                return self._etagged(request, cached["payload"])
            stale = stale or cached
        # One request counts at a time (per run, time zone and questions);
        # the others show the last count rather than count it again.
        lock = "ie-summary-lock:" + _summary_key(task, run, status, view)
        counting = cache.add(lock, 1, 30)
        if not counting and stale is not None:
            return self._etagged(request, stale["payload"])
        try:
            payload = compute_summary(task, run, view, questions)
        except summary_service.BadFilter as exc:
            return self._gm.bad_request(str(exc))
        except Exception:
            logger.exception("instant_eval_summary_failed", task_id=str(task.id))
            return self._gm.custom_error_response(
                503, "The run's answers can't be read right now. Please retry."
            )
        finally:
            if counting:
                cache.delete(lock)
        return self._etagged(request, payload)

    def _etagged(self, request, payload):
        body = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
        etag = '"' + hashlib.sha1(body.encode()).hexdigest() + '"'
        if request.headers.get("If-None-Match") == etag:
            response = Response(status=304)
        else:
            response = self._gm.success_response(payload)
        response["ETag"] = etag
        response["Cache-Control"] = "private, no-cache"
        return response


def _row_filter(params) -> summary_service.RowFilter:
    answers: list[tuple[str | None, str]] = []
    if params.get("answer"):
        answers.append(
            (
                str(params["config_id"]) if params.get("config_id") else None,
                params["answer"],
            )
        )
    if params.get("answers"):
        try:
            extra = json.loads(params["answers"])
        except ValueError:
            raise summary_service.BadFilter("Unreadable answers filter") from None
        if not isinstance(extra, list):
            raise summary_service.BadFilter("Unreadable answers filter")
        for item in extra[:10]:
            if isinstance(item, dict) and item.get("answer"):
                answers.append(
                    (str(item.get("config_id") or "") or None, str(item["answer"]))
                )
    groups = [g for raw in params.get("group") or [] for g in str(raw).split(",") if g]
    return summary_service.RowFilter(
        answers=answers,
        unsure=bool(params.get("unsure")),
        unsure_config=str(params["config_id"]) if params.get("config_id") else None,
        time_from=summary_service.parse_time(params.get("time_from")),
        time_to=summary_service.parse_time(params.get("time_to")),
        groups=groups,
        user=params.get("user") or None,
        model=params.get("model"),
        error=params.get("error"),
        q=(params.get("q") or "").strip() or None,
    )


@method_decorator(gzip_page, name="dispatch")
class InstantEvalRowsView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        query_serializer=InstantEvalRowsQuerySerializer,
        responses={200: InstantEvalRowsResponseSerializer, **ERRORS},
    )
    def get(self, request):
        """One page of a run's rows with their answers, filtered by what the
        charts select: an answer, a time range, a group, unsure answers or text."""
        params = request.validated_query_data
        task, error = _load(request, params, self._gm)
        if error:
            return error
        try:
            run = _prepared_run(task, params)
            _ensure_answers(run)
            view, _ = _view(task, run, params)
            limit = MAX_COMPACT_PAGE if params.get("compact") else MAX_PAGE_SIZE
            page = summary_service.rows_page(
                view,
                _row_filter(params),
                cursor=params.get("cursor") or None,
                page_size=min(params["page_size"], limit),
                compact=bool(params.get("compact")),
                sort=params["sort"],
                sort_config=str(params["config_id"])
                if params.get("config_id")
                else None,
            )
        except summary_service.BadFilter as exc:
            return self._gm.bad_request(str(exc))
        except Exception:
            logger.exception("instant_eval_rows_failed", task_id=str(task.id))
            return self._gm.custom_error_response(
                503, "The run's rows can't be read right now. Please retry."
            )
        return self._gm.success_response(page)


class InstantEvalExportView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        query_serializer=InstantEvalRowsQuerySerializer,
        responses={
            200: openapi.Response(
                description="Every selected row with its answers, as CSV.",
                schema=openapi.Schema(type=openapi.TYPE_STRING),
            ),
            **ERRORS,
        },
    )
    def get(self, request):
        """Every row the filter selects, with each question's answer,
        confidence and explanation, streamed as CSV."""
        params = request.validated_query_data
        task, error = _load(request, params, self._gm)
        if error:
            return error
        try:
            run = _prepared_run(task, params)
            _ensure_answers(run)
            view, questions = _view(task, run, params)
            row_filter = _row_filter(params)
        except summary_service.BadFilter as exc:
            return self._gm.bad_request(str(exc))
        response = StreamingHttpResponse(
            summary_service.iter_export(view, row_filter, questions),
            content_type="text/csv",
        )
        response["Content-Type"] = "text/csv; charset=utf-8"
        response["Content-Disposition"] = (
            f'attachment; filename="instant-eval-{task.id}.csv"'
        )
        return response


# ─── Control ─────────────────────────────────────────────────────────────────
class InstantEvalControlView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        request_serializer=InstantEvalControlRequestSerializer,
        responses={200: InstantEvalControlResponseSerializer, **LIMIT_ERRORS},
    )
    def post(self, request):
        """Pause, resume or cancel a run, retry the rows Jev failed on, or
        read more of a sample. Resuming, retrying and reading more count
        against the organization's runs in flight."""
        data = request.validated_data
        task, error = _load(request, data, self._gm)
        if error:
            return error
        run = _run_of(task)
        action = data["action"]
        handler = getattr(self, f"_{action}")
        return handler(request, task, run, data)

    def _ok(self, task, message, **extra):
        task.refresh_from_db(fields=["status"])
        run = _run_of(task)
        return self._gm.success_response(
            {"status": _status(task, run), "message": message, **extra}
        )

    def _busy(self, request, task):
        others = [r for r in _active_runs(_org(request)) if r.eval_task_id != task.id]
        return _busy_response(self._gm, others) if len(others) >= max_active() else None

    def _pause(self, request, task, run, data):
        from tfc.temporal.eval_tasks.client import signal_pause_eval_task_workflow

        if task.status not in ACTIVE:
            return self._gm.bad_request(
                f"The run is {task.status}; only a running run can be paused."
            )
        EvalTask.objects.filter(id=task.id).update(status=EvalTaskStatus.PAUSED)
        if run is not None:
            InstantEvalRun.objects.filter(id=run.id).update(
                answers_version=F("answers_version") + 1
            )
        try:
            signal_pause_eval_task_workflow(task.id)
        except Exception:
            # The paused status is what the workflow checks at every batch.
            logger.warning("instant_eval_pause_signal_failed", task_id=str(task.id))
        return self._ok(task, "Paused. Answers already being read will still land.")

    def _restart(self, task):
        EvalTask.objects.filter(id=task.id).update(status=EvalTaskStatus.PENDING)
        task.status = EvalTaskStatus.PENDING
        _start_workflow_on_commit(task, replace=True)

    def _resume(self, request, task, run, data):
        cancelled = bool(run and run.cancelled_at)
        resumable = task.status in RESUMABLE_TASK_STATUSES or cancelled
        if not resumable and run is not None:
            # A run that stopped before finishing: its workflow is gone while
            # the task says running, or it finished with rows unanswered.
            if task.status in ACTIVE:
                cache.delete(f"ie-wf-gone:{task.id}")
                resumable = _workflow_gone(task)
            elif task.status == EvalTaskStatus.COMPLETED:
                resumable = _unanswered_rows(run) > 0
        if not resumable:
            return self._gm.bad_request(
                f"The run is {task.status}; only a paused or stopped run can be resumed."
            )
        if busy := self._busy(request, task):
            return busy
        if run is not None:
            left = _unanswered_rows(run)
            credits = _credits(left, run.questions)
            if refused := check_credits(_org(request), credits):
                return _credit_refusal(
                    self._gm, refused, credits, run.unit, run.questions, left
                )
        with transaction.atomic():
            if run is not None:
                InstantEvalRun.objects.filter(id=run.id).update(
                    cancelled_at=None, answers_version=F("answers_version") + 1
                )
            # The fresh run reads only the rows still without an answer.
            self._restart(task)
        cache.delete(f"ie-wf-gone:{task.id}")
        return self._ok(task, "Resumed.")

    def _cancel(self, request, task, run, data):
        from tfc.temporal.eval_tasks.client import signal_pause_eval_task_workflow

        if run is None:
            return self._gm.bad_request(
                "Only a run started from the Ask page can be cancelled."
            )
        if run.cancelled_at:
            return self._ok(task, "Already cancelled.")
        if task.status == EvalTaskStatus.COMPLETED:
            return self._gm.bad_request("The run has finished.")
        with transaction.atomic():
            InstantEvalRun.objects.filter(id=run.id).update(
                cancelled_at=timezone.now(), answers_version=F("answers_version") + 1
            )
            EvalTask.objects.filter(id=task.id).update(status=EvalTaskStatus.PAUSED)
        try:
            signal_pause_eval_task_workflow(task.id)
        except Exception:
            logger.warning("instant_eval_cancel_signal_failed", task_id=str(task.id))
        return self._ok(
            task, "Cancelled. Rows not read yet won't be read; the answers so far stay."
        )

    def _retry_failed(self, request, task, run, data):
        failed = EvalLogger.objects.filter(
            eval_task_id=str(task.id),
            deleted=False,
            status__in=[EvalEntryStatus.ERRORED, EvalEntryStatus.SKIPPED],
        )
        running = task.status in ACTIVE
        if not running and (busy := self._busy(request, task)):
            return busy
        if run is not None:
            # Each failed entry is one answer to read again.
            credits = _credits(failed.count(), 1)
            if refused := check_credits(_org(request), credits):
                return _credit_refusal(self._gm, refused, credits, run.unit, 1, 0)
        from tracer.services.instant_eval_answers import forget_answers

        with transaction.atomic():
            ids = list(failed.values_list("id", flat=True))
            retried = failed.update(
                status=EvalEntryStatus.PENDING,
                error=False,
                error_message=None,
                skipped_reason=None,
                attempts=0,
            )
            if not retried:
                return self._gm.bad_request("No rows failed.")
            # Their rows wait for an answer again.
            forget_answers(task.id, ids)
            if run is not None:
                InstantEvalRun.objects.filter(id=run.id).update(
                    cancelled_at=None, answers_version=F("answers_version") + 1
                )
            # A run still draining claims the requeued rows itself.
            if not running:
                self._restart(task)
        return self._ok(task, f"Retrying {retried:,} answers.", retried=retried)

    def _read_more(self, request, task, run, data):
        if run is None or run.rows_requested >= run.population:
            return self._gm.bad_request("This run already reads every row of its view.")
        if task.status in ACTIVE:
            return self._gm.custom_error_response(
                409,
                {
                    "message": "Wait for this run to finish, or pause it, before reading more.",
                    "error_code": "INSTANT_EVAL_RUNNING",
                },
                code="instant_eval_running",
            )
        if busy := self._busy(request, task):
            return busy
        more = data.get("more")
        target = (
            run.population
            if more is None
            else min(run.population, run.rows_requested + more)
        )
        added = target - run.rows_requested
        rows = _rows_for(run.unit, target)
        if rows > max_rows():
            return self._gm.custom_error_response(
                400,
                f"A run reads at most {max_rows():,} rows; this would read {rows:,}.",
                code="instant_eval_too_large",
            )
        credits = _credits(_rows_for(run.unit, added), run.questions)
        if refused := check_credits(_org(request), credits):
            return _credit_refusal(
                self._gm, refused, credits, run.unit, run.questions, added
            )
        if _rows_for(run.unit, added) > confirm_rows() and not data.get("confirm"):
            return self._gm.custom_error_response(
                409,
                {
                    "message": f"Reading {added:,} more rows costs about {credits:,.0f} credits. Confirm to start.",
                    "error_code": "INSTANT_EVAL_CONFIRM",
                    "rows_to_read": _rows_for(run.unit, added),
                    "credits_estimate": credits,
                },
                code="confirm_required",
            )
        with transaction.atomic():
            InstantEvalRun.objects.filter(id=run.id).update(
                rows_requested=target,
                sample_size=None if target >= run.population else target,
                credits_estimate=run.credits_estimate + credits,
                cancelled_at=None,
                answers_version=F("answers_version") + 1,
            )
            EvalTask.objects.filter(id=task.id).update(spans_limit=rows)
            self._restart(task)
        return self._ok(task, f"Reading {added:,} more.", rows_requested=target)
