"""
Analyse tab endpoints.

POST /tracer/analyse/discover/ — propose categories for a sample of traces
"""

import structlog
from django.core.cache import cache
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from tfc.utils.api_contracts import validated_request
from tfc.utils.api_serializers import ApiErrorResponseSerializer
from tfc.utils.general_methods import GeneralMethods
from tracer.models.project import Project

logger = structlog.get_logger(__name__)

ERROR_RESPONSES = {
    400: ApiErrorResponseSerializer,
    403: ApiErrorResponseSerializer,
    404: ApiErrorResponseSerializer,
    429: ApiErrorResponseSerializer,
    500: ApiErrorResponseSerializer,
    503: ApiErrorResponseSerializer,
}

# Each proposal is one large generative call; keep a runaway client from
# spending an organization's budget.
DISCOVERIES_PER_HOUR = 30


class AnalyseDiscoverRequestSerializer(serializers.Serializer):
    project_id = serializers.UUIDField()
    trace_ids = serializers.ListField(
        child=serializers.CharField(max_length=255),
        min_length=10,
        max_length=150,
    )
    focus = serializers.CharField(max_length=500, required=False, allow_blank=True)


class AnalyseDiscoverExampleSerializer(serializers.Serializer):
    trace_id = serializers.CharField()
    quote = serializers.CharField()


class AnalyseDiscoverCategorySerializer(serializers.Serializer):
    label = serializers.CharField()
    definition = serializers.CharField()
    examples = AnalyseDiscoverExampleSerializer(many=True)
    sample_count = serializers.IntegerField()


class AnalyseDiscoverProposalSerializer(serializers.Serializer):
    question = serializers.CharField()
    categories = AnalyseDiscoverCategorySerializer(many=True)
    sample_size = serializers.IntegerField()
    unassigned = serializers.IntegerField()
    model = serializers.CharField()
    cost_usd = serializers.FloatField()
    dropped_quotes = serializers.IntegerField()


class AnalyseDiscoverResponseSerializer(serializers.Serializer):
    status = serializers.BooleanField(default=True)
    result = AnalyseDiscoverProposalSerializer()


def _spend_discovery(org_id) -> bool:
    key = f"analyse-discover:{org_id}"
    cache.add(key, 0, timeout=3600)
    try:
        return cache.incr(key) <= DISCOVERIES_PER_HOUR
    except ValueError:
        cache.set(key, 1, timeout=3600)
        return True


class AnalyseDiscoverView(APIView):
    permission_classes = [IsAuthenticated]
    _gm = GeneralMethods()

    @validated_request(
        request_serializer=AnalyseDiscoverRequestSerializer,
        responses={200: AnalyseDiscoverResponseSerializer, **ERROR_RESPONSES},
    )
    def post(self, request):
        """Propose a single-choice question and categories for a trace sample."""
        try:
            from ee.agenthub.analyse.discovery import (
                DiscoveryError,
                discover_categories,
            )
        except ImportError:
            return self._gm.custom_error_response(
                status.HTTP_403_FORBIDDEN,
                "Discover is not available in this edition.",
                code="feature_unavailable",
            )

        data = request.validated_data
        org = getattr(request, "organization", None) or request.user.organization
        if not Project.objects.filter(
            id=data["project_id"], organization=org, deleted=False
        ).exists():
            return self._gm.not_found("Project not found")

        if not _spend_discovery(org.id):
            return self._gm.custom_error_response(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many discoveries this hour. Try again later.",
                code="rate_limited",
            )

        trace_ids = list(dict.fromkeys(data["trace_ids"]))
        try:
            proposal = discover_categories(
                str(data["project_id"]), trace_ids, data.get("focus") or ""
            )
        except DiscoveryError as exc:
            return self._gm.custom_error_response(
                (
                    status.HTTP_503_SERVICE_UNAVAILABLE
                    if "unavailable" in str(exc)
                    else status.HTTP_400_BAD_REQUEST
                ),
                str(exc),
                code="discovery_failed",
            )
        return self._gm.success_response(proposal.as_dict())
