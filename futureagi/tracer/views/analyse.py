"""
Analyse: Insights-style reports over traces, sessions and users.

GET    /tracer/analyse/configs/                 saved reports of a project
GET    /tracer/analyse/configs/<id>/            one report: config and its runs
PATCH  /tracer/analyse/configs/<id>/            rename, or reset the taxonomy
DELETE /tracer/analyse/configs/<id>/            delete a report
POST   /tracer/analyse/draft/                   guided setup from a goal + examples
POST   /tracer/analyse/preview/                 what the extractor reads from 3 units
POST   /tracer/analyse/runs/                    start a run (new or saved report)
GET    /tracer/analyse/runs/<id>/               run status and results
GET    /tracer/analyse/runs/<id>/units/         analysed units, by category
"""

from datetime import timedelta

import structlog
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from tfc.capabilities import service as capability_service
from tfc.utils.api_contracts import validated_request
from tfc.utils.api_serializers import ApiErrorResponseSerializer
from tfc.utils.general_methods import GeneralMethods
from tracer.models.analyse import (
    AnalyseConfig,
    AnalyseLens,
    AnalyseRun,
    AnalyseUnit,
    AnalyseUnitType,
)
from tracer.models.project import Project

logger = structlog.get_logger(__name__)

ERROR_RESPONSES = {
    400: ApiErrorResponseSerializer,
    402: ApiErrorResponseSerializer,
    403: ApiErrorResponseSerializer,
    404: ApiErrorResponseSerializer,
    429: ApiErrorResponseSerializer,
    500: ApiErrorResponseSerializer,
    503: ApiErrorResponseSerializer,
}

RUNS_PER_HOUR = 30
ACTIVE_RUN_WINDOW = timedelta(hours=2)
DRAFTS_PER_HOUR = 60
MAX_POPULATION = 20000
UNITS_PAGE = 50


# ─── Request serializers ─────────────────────────────────────────────────────
class AnalyseAttributeSerializer(serializers.Serializer):
    key = serializers.CharField(max_length=60)
    type = serializers.ChoiceField(choices=["boolean", "number", "string"])
    description = serializers.CharField(max_length=300, required=False, allow_blank=True)
    filter_by = serializers.BooleanField(required=False, default=False)


class AnalyseConfigInputSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    unit = serializers.ChoiceField(choices=AnalyseUnitType.choices)
    lens = serializers.ChoiceField(choices=AnalyseLens.choices)
    question = serializers.CharField(max_length=500)
    agent_description = serializers.CharField(max_length=500, required=False, allow_blank=True)
    instructions = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    attributes = AnalyseAttributeSerializer(many=True, required=False)
    sample_size = serializers.IntegerField(min_value=10, max_value=1000, required=False)


class AnalysePopulationItemSerializer(serializers.Serializer):
    id = serializers.CharField(max_length=255)
    time = serializers.CharField(max_length=64, required=False, allow_blank=True)
    user_id = serializers.CharField(max_length=255, required=False, allow_blank=True)


class AnalyseScopeSerializer(serializers.Serializer):
    filters = serializers.ListField(child=serializers.JSONField(), required=False)
    label = serializers.CharField(max_length=300, required=False, allow_blank=True)
    # A relative window ("24h", "7d", "30d") is re-anchored to now on rerun.
    preset = serializers.CharField(max_length=16, required=False, allow_blank=True)
    window = serializers.ListField(
        child=serializers.CharField(max_length=64), required=False, max_length=2
    )


class AnalyseRunCreateSerializer(serializers.Serializer):
    project_id = serializers.UUIDField()
    config_id = serializers.UUIDField(required=False)
    config = AnalyseConfigInputSerializer(required=False)
    scope = AnalyseScopeSerializer(required=False)
    population = AnalysePopulationItemSerializer(
        many=True, min_length=1, max_length=MAX_POPULATION
    )
    sample_size = serializers.IntegerField(min_value=10, max_value=1000, required=False)

    def validate(self, attrs):
        if not attrs.get("config_id") and not attrs.get("config"):
            raise serializers.ValidationError("Provide config_id or config.")
        return attrs


class AnalyseDraftSerializer(serializers.Serializer):
    project_id = serializers.UUIDField()
    unit = serializers.ChoiceField(choices=AnalyseUnitType.choices)
    lens = serializers.ChoiceField(choices=AnalyseLens.choices)
    goal = serializers.CharField(max_length=500, required=False, allow_blank=True)
    agent_description = serializers.CharField(max_length=500, required=False, allow_blank=True)
    sample_ids = serializers.ListField(
        child=serializers.CharField(max_length=255), min_length=1, max_length=5
    )


class AnalysePreviewSerializer(serializers.Serializer):
    project_id = serializers.UUIDField()
    config = AnalyseConfigInputSerializer()
    unit_ids = serializers.ListField(
        child=serializers.CharField(max_length=255), min_length=1, max_length=3
    )


class AnalyseConfigsQuerySerializer(serializers.Serializer):
    project_id = serializers.UUIDField()


class AnalyseConfigPatchSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False)
    reset_taxonomy = serializers.BooleanField(required=False, default=False)


class AnalyseUnitsQuerySerializer(serializers.Serializer):
    category_id = serializers.CharField(max_length=64, required=False, allow_blank=True)
    sub_category_id = serializers.CharField(max_length=64, required=False, allow_blank=True)
    unit_ids = serializers.CharField(max_length=4000, required=False, allow_blank=True)
    offset = serializers.IntegerField(min_value=0, required=False, default=0)
    limit = serializers.IntegerField(min_value=1, max_value=200, required=False, default=UNITS_PAGE)


# ─── Response serializers ────────────────────────────────────────────────────
class AnalyseRunSummarySerializer(serializers.Serializer):
    id = serializers.UUIDField()
    status = serializers.CharField()
    stage = serializers.CharField()
    created_at = serializers.DateTimeField()
    finished_at = serializers.DateTimeField(allow_null=True)
    population_size = serializers.IntegerField()
    sample_size = serializers.IntegerField()
    analysed_count = serializers.IntegerField()
    taxonomy_mode = serializers.CharField()
    distribution = serializers.ListField(child=serializers.JSONField())
    scope = serializers.JSONField()


class AnalyseConfigItemSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    unit = serializers.CharField()
    lens = serializers.CharField()
    question = serializers.CharField()
    agent_description = serializers.CharField(allow_blank=True)
    instructions = serializers.CharField(allow_blank=True)
    attributes = serializers.ListField(child=serializers.JSONField())
    sample_size = serializers.IntegerField()
    scope = serializers.JSONField()
    has_taxonomy = serializers.BooleanField()
    taxonomy = serializers.JSONField()
    created_at = serializers.DateTimeField()
    latest_run = AnalyseRunSummarySerializer(allow_null=True)
    runs = AnalyseRunSummarySerializer(many=True, required=False)


class AnalyseConfigListResultSerializer(serializers.Serializer):
    configs = AnalyseConfigItemSerializer(many=True)


class AnalyseConfigListResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = AnalyseConfigListResultSerializer()


class AnalyseConfigResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = AnalyseConfigItemSerializer()


class AnalyseRunDetailSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    config_id = serializers.UUIDField()
    project_id = serializers.UUIDField()
    status = serializers.CharField()
    stage = serializers.CharField()
    progress = serializers.JSONField()
    unit = serializers.CharField()
    scope = serializers.JSONField()
    settings = serializers.JSONField()
    population_size = serializers.IntegerField()
    sample_size = serializers.IntegerField()
    analysed_count = serializers.IntegerField()
    taxonomy_mode = serializers.CharField()
    result = serializers.JSONField()
    models_used = serializers.JSONField()
    cost_usd = serializers.FloatField()
    error = serializers.CharField(allow_blank=True)
    created_at = serializers.DateTimeField()
    started_at = serializers.DateTimeField(allow_null=True)
    finished_at = serializers.DateTimeField(allow_null=True)
    previous_run_id = serializers.UUIDField(allow_null=True)
    next_run_id = serializers.UUIDField(allow_null=True)


class AnalyseRunResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = AnalyseRunDetailSerializer()


class AnalyseRunCreatedResultSerializer(serializers.Serializer):
    run_id = serializers.UUIDField()
    config_id = serializers.UUIDField()


class AnalyseRunCreatedResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = AnalyseRunCreatedResultSerializer()


class AnalyseUnitItemSerializer(serializers.Serializer):
    unit_id = serializers.CharField()
    label = serializers.CharField(allow_blank=True)
    user_id = serializers.CharField(allow_blank=True)
    session_id = serializers.CharField(allow_blank=True)
    time = serializers.DateTimeField(allow_null=True)
    excerpt = serializers.CharField(allow_blank=True)
    summary = serializers.CharField(allow_blank=True)
    lens_answer = serializers.CharField(allow_blank=True)
    facets = serializers.JSONField()
    metrics = serializers.JSONField()
    category_id = serializers.CharField(allow_blank=True)
    sub_category_id = serializers.CharField(allow_blank=True)


class AnalyseUnitsResultSerializer(serializers.Serializer):
    units = AnalyseUnitItemSerializer(many=True)
    total = serializers.IntegerField()


class AnalyseUnitsResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = AnalyseUnitsResultSerializer()


class AnalyseDraftResultSerializer(serializers.Serializer):
    name = serializers.CharField()
    question = serializers.CharField()
    agent_description = serializers.CharField(allow_blank=True)
    instructions = serializers.CharField(allow_blank=True)
    attributes = serializers.ListField(child=serializers.JSONField())
    examples_read = serializers.IntegerField()


class AnalyseDraftResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = AnalyseDraftResultSerializer()


class AnalysePreviewResultSerializer(serializers.Serializer):
    units = serializers.ListField(child=serializers.JSONField())


class AnalysePreviewResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = AnalysePreviewResultSerializer()


# ─── Helpers ─────────────────────────────────────────────────────────────────
def _org(request):
    return getattr(request, "organization", None) or request.user.organization


def _workspace(request):
    return getattr(request, "workspace", None)


def _project(request, project_id):
    return Project.objects.filter(
        id=project_id, organization=_org(request), deleted=False
    ).first()


def _spend(kind: str, org_id, limit: int) -> bool:
    key = f"analyse-{kind}:{org_id}"
    cache.add(key, 0, timeout=3600)
    try:
        return cache.incr(key) <= limit
    except ValueError:
        cache.set(key, 1, timeout=3600)
        return True


def _distribution(run) -> list[dict]:
    categories = (run.result or {}).get("categories") or []
    tops = [c for c in categories if c.get("level") == 1]
    tops.sort(key=lambda c: -c["stats"]["count"])
    return [
        {
            "category_id": c["id"],
            "name": c["name"],
            "share": c["stats"]["share"],
            "count": c["stats"]["count"],
            "status": c.get("status", "active"),
        }
        for c in tops
    ]


def _run_summary(run) -> dict:
    return {
        "id": run.id,
        "status": run.status,
        "stage": run.stage,
        "created_at": run.created_at,
        "finished_at": run.finished_at,
        "population_size": run.population_size,
        "sample_size": run.sample_size,
        "analysed_count": run.analysed_count,
        "taxonomy_mode": run.taxonomy_mode,
        "distribution": _distribution(run),
        "scope": run.scope or {},
    }


def _config_item(config, *, with_runs=False) -> dict:
    runs = list(config.runs.filter(deleted=False).order_by("-created_at"))
    item = {
        "id": config.id,
        "name": config.name,
        "unit": config.unit,
        "lens": config.lens,
        "question": config.question,
        "agent_description": config.agent_description,
        "instructions": config.instructions,
        "attributes": config.attributes or [],
        "sample_size": config.sample_size,
        "scope": config.scope or {},
        "has_taxonomy": bool((config.taxonomy or {}).get("subs")),
        "taxonomy": config.taxonomy or {},
        "created_at": config.created_at,
        "latest_run": _run_summary(runs[0]) if runs else None,
    }
    if with_runs:
        item["runs"] = [_run_summary(r) for r in runs[:50]]
    return item


def _rate_limited(gm):
    return gm.custom_error_response(
        status.HTTP_429_TOO_MANY_REQUESTS,
        "Too many reports this hour. Try again later.",
        code="rate_limited",
    )


def _gate(gm, org):
    if not capability_service.check("turing_models", org_id=str(org.id)).allowed:
        return gm.custom_error_response(
            status.HTTP_402_PAYMENT_REQUIRED,
            "Analyse isn't available on this organization's plan.",
            code="CAPABILITY_DENIED",
        )
    return None


def _start(run) -> None:
    try:
        from tfc.temporal.analyse.client import start_analyse_run

        run.workflow_id = start_analyse_run(str(run.id))
        run.save(update_fields=["workflow_id", "updated_at"])
    except Exception:
        logger.exception("analyse_workflow_start_failed", run_id=str(run.id))
        run.status = "failed"
        run.error = "The report could not be started. Try again shortly."
        run.save(update_fields=["status", "error", "updated_at"])


def _pipeline():
    try:
        from ee.agenthub.analyse import draft, pipeline
        from ee.agenthub.analyse.llm import AnalyseModelError
    except ImportError:
        return None
    return draft, pipeline, AnalyseModelError


def _unavailable(gm):
    return gm.custom_error_response(
        status.HTTP_403_FORBIDDEN,
        "Analyse is not available in this edition.",
        code="feature_unavailable",
    )


# ─── Views ───────────────────────────────────────────────────────────────────
class AnalyseConfigListView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        query_serializer=AnalyseConfigsQuerySerializer,
        responses={200: AnalyseConfigListResponseSerializer, **ERROR_RESPONSES},
    )
    def get(self, request):
        """Saved Analyse reports of a project, newest first, with their latest run."""
        project = _project(request, request.validated_query_data["project_id"])
        if project is None:
            return self._gm.not_found("Project not found")
        configs = AnalyseConfig.objects.filter(project=project, deleted=False).order_by(
            "-created_at"
        )
        return self._gm.success_response({"configs": [_config_item(c) for c in configs]})


class AnalyseConfigDetailView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    def _config(self, request, config_id):
        return AnalyseConfig.objects.filter(
            id=config_id, organization=_org(request), deleted=False
        ).first()

    @validated_request(responses={200: AnalyseConfigResponseSerializer, **ERROR_RESPONSES})
    def get(self, request, config_id):
        """One saved report with every run, for the trend chart and run pager."""
        config = self._config(request, config_id)
        if config is None:
            return self._gm.not_found("Report not found")
        return self._gm.success_response(_config_item(config, with_runs=True))

    @validated_request(
        request_serializer=AnalyseConfigPatchSerializer,
        responses={200: AnalyseConfigResponseSerializer, **ERROR_RESPONSES},
    )
    def patch(self, request, config_id):
        """Rename a report, or forget its saved categories so the next run discovers afresh."""
        config = self._config(request, config_id)
        if config is None:
            return self._gm.not_found("Report not found")
        data = request.validated_data
        fields = ["updated_at"]
        if data.get("name"):
            config.name = data["name"]
            fields.append("name")
        if data.get("reset_taxonomy"):
            config.taxonomy = {}
            fields.append("taxonomy")
        config.save(update_fields=fields)
        return self._gm.success_response(_config_item(config, with_runs=True))

    @validated_request(responses={200: AnalyseConfigResponseSerializer, **ERROR_RESPONSES})
    def delete(self, request, config_id):
        """Delete a saved report and hide its runs."""
        config = self._config(request, config_id)
        if config is None:
            return self._gm.not_found("Report not found")
        item = _config_item(config)
        config.delete()
        AnalyseRun.objects.filter(config=config).update(deleted=True)
        return self._gm.success_response(item)


class AnalyseDraftView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        request_serializer=AnalyseDraftSerializer,
        responses={200: AnalyseDraftResponseSerializer, **ERROR_RESPONSES},
    )
    def post(self, request):
        """Read a few real units and draft a report setup for the team's goal."""
        modules = _pipeline()
        if modules is None:
            return _unavailable(self._gm)
        draft, _, AnalyseModelError = modules
        data = request.validated_data
        org = _org(request)
        if _project(request, data["project_id"]) is None:
            return self._gm.not_found("Project not found")
        denied = _gate(self._gm, org)
        if denied:
            return denied
        if not _spend("draft", org.id, DRAFTS_PER_HOUR):
            return self._gm.custom_error_response(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many drafts this hour. Try again later.",
                code="rate_limited",
            )
        try:
            result = draft.draft_config(
                project_id=str(data["project_id"]),
                unit=data["unit"],
                lens_key=data["lens"],
                goal=data.get("goal") or "",
                agent_description=data.get("agent_description") or "",
                sample_ids=data["sample_ids"],
            )
        except AnalyseModelError as exc:
            return self._gm.custom_error_response(
                status.HTTP_503_SERVICE_UNAVAILABLE, str(exc), code="analyse_unavailable"
            )
        result.pop("cost_usd", None)
        return self._gm.success_response(result)


class AnalysePreviewView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        request_serializer=AnalysePreviewSerializer,
        responses={200: AnalysePreviewResponseSerializer, **ERROR_RESPONSES},
    )
    def post(self, request):
        """Show what the report will read from up to three units before running it."""
        modules = _pipeline()
        if modules is None:
            return _unavailable(self._gm)
        draft, _, AnalyseModelError = modules
        data = request.validated_data
        org = _org(request)
        if _project(request, data["project_id"]) is None:
            return self._gm.not_found("Project not found")
        denied = _gate(self._gm, org)
        if denied:
            return denied
        if not _spend("draft", org.id, DRAFTS_PER_HOUR):
            return self._gm.custom_error_response(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many previews this hour. Try again later.",
                code="rate_limited",
            )
        config = data["config"]
        try:
            units = draft.preview(
                project_id=str(data["project_id"]),
                unit=config["unit"],
                lens_key=config["lens"],
                question=config["question"],
                agent_description=config.get("agent_description") or "",
                instructions=config.get("instructions") or "",
                attributes=config.get("attributes") or [],
                unit_ids=data["unit_ids"],
            )
        except AnalyseModelError as exc:
            return self._gm.custom_error_response(
                status.HTTP_503_SERVICE_UNAVAILABLE, str(exc), code="analyse_unavailable"
            )
        return self._gm.success_response({"units": units})


class AnalyseRunCreateView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        request_serializer=AnalyseRunCreateSerializer,
        responses={200: AnalyseRunCreatedResponseSerializer, **ERROR_RESPONSES},
    )
    def post(self, request):
        """Start a report run over a sampled population; creates the report when new."""
        modules = _pipeline()
        if modules is None:
            return _unavailable(self._gm)
        _, pipeline, _ = modules
        data = request.validated_data
        org = _org(request)
        project = _project(request, data["project_id"])
        if project is None:
            return self._gm.not_found("Project not found")
        denied = _gate(self._gm, org)
        if denied:
            return denied
        scope = data.get("scope") or {}
        if data.get("config_id"):
            config = AnalyseConfig.objects.filter(
                id=data["config_id"], project=project, deleted=False
            ).first()
            if config is None:
                return self._gm.not_found("Report not found")
            # One run per report at a time: a second "Run again" joins the run
            # in flight instead of racing it (a run stuck for hours doesn't block).
            active = (
                AnalyseRun.objects.filter(
                    config=config,
                    status__in=["pending", "running"],
                    deleted=False,
                    created_at__gte=timezone.now() - ACTIVE_RUN_WINDOW,
                )
                .order_by("-created_at")
                .first()
            )
            if active is not None:
                return self._gm.success_response(
                    {"run_id": active.id, "config_id": config.id}
                )
            if not _spend("run", org.id, RUNS_PER_HOUR):
                return _rate_limited(self._gm)
            if scope:
                config.scope = scope
                config.save(update_fields=["scope", "updated_at"])
        else:
            if not _spend("run", org.id, RUNS_PER_HOUR):
                return _rate_limited(self._gm)
            spec = data["config"]
            config = AnalyseConfig.objects.create(
                project=project,
                organization=org,
                workspace=_workspace(request) or project.workspace,
                created_by=request.user,
                name=spec["name"],
                unit=spec["unit"],
                lens=spec["lens"],
                question=spec["question"],
                agent_description=spec.get("agent_description") or "",
                instructions=spec.get("instructions") or "",
                attributes=list(spec.get("attributes") or []),
                scope=scope,
                sample_size=spec.get("sample_size") or data.get("sample_size") or 300,
            )
        run = pipeline.create_run(
            config=config,
            scope=scope,
            population=data["population"],
            sample_size=data.get("sample_size") or config.sample_size,
            user=request.user,
        )
        _start(run)
        return self._gm.success_response({"run_id": run.id, "config_id": config.id})


class AnalyseRunDetailView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(responses={200: AnalyseRunResponseSerializer, **ERROR_RESPONSES})
    def get(self, request, run_id):
        """A run's progress while it works, and its full report once complete."""
        run = (
            AnalyseRun.objects.filter(id=run_id, organization=_org(request), deleted=False)
            .select_related("config")
            .first()
        )
        if run is None:
            return self._gm.not_found("Report run not found")
        siblings = AnalyseRun.objects.filter(config_id=run.config_id, deleted=False)
        previous = siblings.filter(created_at__lt=run.created_at).order_by("-created_at").first()
        following = siblings.filter(created_at__gt=run.created_at).order_by("created_at").first()
        return self._gm.success_response(
            {
                "id": run.id,
                "config_id": run.config_id,
                "project_id": run.project_id,
                "status": run.status,
                "stage": run.stage,
                "progress": run.progress or {},
                "unit": run.unit,
                "scope": run.scope or {},
                "settings": run.settings or {},
                "population_size": run.population_size,
                "sample_size": run.sample_size,
                "analysed_count": run.analysed_count,
                "taxonomy_mode": run.taxonomy_mode,
                "result": run.result or {},
                "models_used": run.models_used or {},
                "cost_usd": run.cost_usd,
                "error": run.error,
                "created_at": run.created_at,
                "started_at": run.started_at,
                "finished_at": run.finished_at,
                "previous_run_id": previous.id if previous else None,
                "next_run_id": following.id if following else None,
            }
        )


class AnalyseRunUnitsView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        query_serializer=AnalyseUnitsQuerySerializer,
        responses={200: AnalyseUnitsResponseSerializer, **ERROR_RESPONSES},
    )
    def get(self, request, run_id):
        """Analysed units of a run, optionally one category's, oldest first."""
        run = AnalyseRun.objects.filter(
            id=run_id, organization=_org(request), deleted=False
        ).first()
        if run is None:
            return self._gm.not_found("Report run not found")
        params = request.validated_query_data
        units = AnalyseUnit.objects.filter(run=run, status="done", included=True)
        if params.get("sub_category_id"):
            units = units.filter(sub_category_id=params["sub_category_id"])
        elif params.get("category_id"):
            units = units.filter(
                Q(category_id=params["category_id"])
                | Q(sub_category_id=params["category_id"])
            )
        if params.get("unit_ids"):
            wanted = [u for u in params["unit_ids"].split(",") if u][:100]
            units = units.filter(unit_id__in=wanted)
        total = units.count()
        offset, limit = params.get("offset", 0), params.get("limit", UNITS_PAGE)
        page = units.order_by("time", "id")[offset : offset + limit]
        return self._gm.success_response(
            {
                "units": [
                    {
                        "unit_id": u.unit_id,
                        "label": u.label,
                        "user_id": u.user_id,
                        "session_id": u.session_id,
                        "time": u.time,
                        "excerpt": u.excerpt,
                        "summary": u.summary,
                        "lens_answer": u.lens_answer,
                        "facets": u.facets or {},
                        "metrics": u.metrics or {},
                        "category_id": u.category_id,
                        "sub_category_id": u.sub_category_id,
                    }
                    for u in page
                ],
                "total": total,
            }
        )
