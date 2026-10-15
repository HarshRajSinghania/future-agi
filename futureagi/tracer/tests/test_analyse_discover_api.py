import uuid

import pytest
from rest_framework import status

from accounts.models.organization import Organization
from model_hub.models.ai_model import AIModel
from tracer.models.project import Project

DISCOVER_PATH = "/tracer/analyse/discover/"


@pytest.fixture(autouse=True)
def jev_enabled(monkeypatch):
    from tfc.capabilities import service as capability_service
    from tfc.capabilities.service import CapabilityDecision

    monkeypatch.setattr(
        capability_service,
        "check",
        lambda feature_id, **_: CapabilityDecision(allowed=True, feature_id=feature_id),
    )


def trace_ids(n=12):
    return [str(uuid.uuid4()) for _ in range(n)]


@pytest.mark.django_db
def test_discover_returns_the_validated_proposal(
    auth_client, observe_project, monkeypatch
):
    from ee.agenthub.analyse import discovery

    calls = []

    def fake_discover(project_id, ids, focus):
        calls.append((project_id, ids, focus))
        return discovery.Proposal(
            question="Why?",
            categories=[
                {"label": "A", "definition": "a", "examples": [], "sample_count": 3}
            ],
            sample_size=12,
            unassigned=9,
            model="m",
        )

    monkeypatch.setattr(discovery, "discover_categories", fake_discover)
    ids = trace_ids()
    response = auth_client.post(
        DISCOVER_PATH,
        data={
            "project_id": str(observe_project.id),
            "trace_ids": ids + ids[:2],
            "focus": "goal",
        },
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK
    assert response.json()["result"]["question"] == "Why?"
    # Duplicate ids are dropped before the sample is read.
    assert calls == [(str(observe_project.id), ids, "goal")]


@pytest.mark.django_db
def test_discover_rejects_projects_of_other_organizations(
    auth_client, workspace, monkeypatch
):
    other = Organization.objects.create(name="Other org")
    project = getattr(Project, "no_workspace_objects", Project.objects).create(
        name="Elsewhere",
        organization=other,
        model_type=AIModel.ModelTypes.GENERATIVE_LLM,
        trace_type="observe",
    )
    from ee.agenthub.analyse import discovery

    monkeypatch.setattr(
        discovery, "discover_categories", lambda *_: pytest.fail("must not read")
    )
    response = auth_client.post(
        DISCOVER_PATH,
        data={"project_id": str(project.id), "trace_ids": trace_ids()},
        format="json",
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_discover_validates_sample_size(auth_client, observe_project):
    response = auth_client.post(
        DISCOVER_PATH,
        data={"project_id": str(observe_project.id), "trace_ids": trace_ids(3)},
        format="json",
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_discover_is_rate_limited_per_organization(
    auth_client, observe_project, monkeypatch
):
    from tracer.views import analyse

    monkeypatch.setattr(analyse, "_spend_discovery", lambda _org: False)
    response = auth_client.post(
        DISCOVER_PATH,
        data={"project_id": str(observe_project.id), "trace_ids": trace_ids()},
        format="json",
    )
    assert response.status_code == status.HTTP_429_TOO_MANY_REQUESTS


@pytest.mark.django_db
def test_discover_requires_authentication(api_client, observe_project):
    response = api_client.post(
        DISCOVER_PATH,
        data={"project_id": str(observe_project.id), "trace_ids": trace_ids()},
        format="json",
    )
    assert response.status_code in (
        status.HTTP_401_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN,
    )


@pytest.mark.django_db
def test_discover_requires_jev(auth_client, observe_project, monkeypatch):
    from tfc.capabilities import service as capability_service
    from tfc.capabilities.service import CapabilityDecision

    monkeypatch.setattr(
        capability_service,
        "check",
        lambda feature_id, **_: CapabilityDecision(
            allowed=False, feature_id=feature_id
        ),
    )
    response = auth_client.post(
        DISCOVER_PATH,
        data={"project_id": str(observe_project.id), "trace_ids": trace_ids()},
        format="json",
    )
    assert response.status_code == status.HTTP_402_PAYMENT_REQUIRED


@pytest.mark.django_db
def test_discover_maps_model_outages_to_503(auth_client, observe_project, monkeypatch):
    from ee.agenthub.analyse import discovery

    def unavailable(*_):
        raise discovery.DiscoveryError("down", unavailable=True)

    monkeypatch.setattr(discovery, "discover_categories", unavailable)
    response = auth_client.post(
        DISCOVER_PATH,
        data={"project_id": str(observe_project.id), "trace_ids": trace_ids()},
        format="json",
    )
    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
