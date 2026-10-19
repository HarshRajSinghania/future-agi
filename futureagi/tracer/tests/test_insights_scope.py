"""Insights scopes resolved on the server: a report over a view's filters and
window reads a sample the server draws, with the same population query
Instant eval uses; rows handed over by id still run as they are; and the
earlier Insights date options read as Observe's."""

import uuid
from datetime import UTC, datetime

import pytest
from rest_framework import status

from tracer.models.insights import InsightConfig, InsightRun, InsightUnit
from tracer.services import instant_eval_rows as rows_service
from tracer.services import instant_eval_users as users_service
from tracer.tests.test_insights_api import RUNS, population
from tracer.tests.test_insights_api import insight_enabled as insight_enabled

ESTIMATE = "/tracer/insights/estimate/"
CONFIGS = "/tracer/insights/configs/"
WINDOW = ["2026-10-01T00:00:00+00:00", "2026-10-08T00:00:00+00:00"]
WINDOW_FROM = datetime(2026, 10, 1, tzinfo=UTC)
WINDOW_TO = datetime(2026, 10, 8, tzinfo=UTC)
ERRORED = {
    "column_id": "status",
    "filter_config": {
        "col_type": "SYSTEM_METRIC",
        "filter_type": "text",
        "filter_op": "equals",
        "filter_value": "ERROR",
    },
}


@pytest.fixture
def scope_view(monkeypatch):
    """A view of 2,345 rows, recording what the server was asked."""
    asked = {"count": [], "pick": []}
    ids = [str(uuid.UUID(int=i + 1)) for i in range(2345)]

    def count(project_id, unit, filters, *, search=None, finish=False):
        asked["count"].append(
            {"unit": unit, "filters": filters, "search": search, "finish": finish}
        )
        return rows_service.Population(
            len(ids), False, WINDOW_FROM, WINDOW_TO, list(filters)
        )

    def pick(project_id, unit, filters, *, n, after, search=None, budget_s=None):
        asked["pick"].append({"unit": unit, "n": n, "after": after, "search": search})
        return [(i, n) for n, i in enumerate(ids[:n])]

    monkeypatch.setattr(users_service, "count_view", count)
    monkeypatch.setattr(users_service, "pick_view", pick)
    asked["ids"] = ids
    return asked


def report(unit="sessions"):
    return {
        "name": "Where is the agent failing?",
        "unit": unit,
        "lens": "failures",
        "question": "Where is the agent failing?",
    }


@pytest.mark.django_db
def test_the_estimate_counts_a_scope_on_the_server(
    auth_client, observe_project, scope_view
):
    response = auth_client.post(
        ESTIMATE,
        {
            "project_id": str(observe_project.id),
            "unit": "sessions",
            "scope": {"filters": [ERRORED], "window": WINDOW, "preset": "7D"},
            "sample_size": 500,
        },
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK, response.json()
    assert response.json()["result"] == {
        "population": 2345,
        "population_is_lower_bound": False,
        "sample_size": 500,
        "window": {"from": WINDOW_FROM.isoformat(), "to": WINDOW_TO.isoformat()},
        # The first units a run over this scope would read.
        "sample_ids": scope_view["ids"][:20],
    }
    asked = scope_view["count"][-1]
    # The window joins the filters as their created_at item.
    assert [f["column_id"] for f in asked["filters"]] == ["status", "created_at"]
    assert asked["filters"][1]["filter_config"]["filter_value"] == WINDOW
    assert asked["finish"] is False


@pytest.mark.django_db
def test_a_report_over_a_scope_reads_a_sample_the_server_draws(
    auth_client, observe_project, scope_view, insight_enabled
):
    response = auth_client.post(
        RUNS,
        {
            "project_id": str(observe_project.id),
            "config": report(),
            "scope": {
                "filters": [ERRORED],
                "window": WINDOW,
                "preset": "7D",
                "label": "Past 7D · 1 filter",
            },
            "sample_size": 50,
        },
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK, response.json()
    run = InsightRun.objects.get(id=response.json()["result"]["run_id"])
    # Every unit of the scope is counted, past the 20,000 a browser could send.
    assert run.population_size == 2345 and run.sample_size == 50
    assert scope_view["count"][-1]["finish"] is True
    assert scope_view["pick"][-1] == {
        "unit": "sessions",
        "n": 50,
        "after": None,
        "search": "",
    }
    units = set(InsightUnit.objects.filter(run=run).values_list("unit_id", flat=True))
    assert units == set(scope_view["ids"][:50])
    # The run reads each unit inside the window the server resolved.
    assert run.scope["window"] == [WINDOW_FROM.isoformat(), WINDOW_TO.isoformat()]
    assert run.scope["preset"] == "7D" and run.scope["label"] == "Past 7D · 1 filter"
    config = InsightConfig.objects.get(id=response.json()["result"]["config_id"])
    assert config.scope["filters"] == [ERRORED] and config.sample_size == 50


@pytest.mark.django_db
def test_a_report_over_fewer_units_than_its_sample_reads_them_all(
    auth_client, observe_project, monkeypatch, insight_enabled
):
    ids = [str(uuid.uuid4()) for _ in range(7)]
    monkeypatch.setattr(
        users_service,
        "count_view",
        lambda *a, **k: rows_service.Population(7, False, WINDOW_FROM, WINDOW_TO, []),
    )
    picks = []
    monkeypatch.setattr(
        users_service,
        "pick_view",
        lambda *a, n, **k: picks.append(n) or [(i, 0) for i in ids[:n]],
    )
    response = auth_client.post(
        RUNS,
        {
            "project_id": str(observe_project.id),
            "config": report(),
            "scope": {"window": WINDOW, "preset": "Custom"},
            "sample_size": 300,
        },
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK, response.json()
    run = InsightRun.objects.get(id=response.json()["result"]["run_id"])
    assert (run.population_size, run.sample_size, picks) == (7, 7, [7])


@pytest.mark.django_db
def test_rows_handed_over_by_id_still_run_as_they_are(
    auth_client, observe_project, scope_view, insight_enabled
):
    handed = population(12)
    response = auth_client.post(
        RUNS,
        {
            "project_id": str(observe_project.id),
            "config": report(),
            "scope": {"label": "12 selected sessions", "preset": "fixed"},
            "population": handed,
            "sample_size": 10,
        },
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK, response.json()
    run = InsightRun.objects.get(id=response.json()["result"]["run_id"])
    assert run.population_size == 12 and run.sample_size == 10
    assert not scope_view["count"] and not scope_view["pick"]
    assert run.scope["preset"] == "fixed"


@pytest.mark.django_db
def test_a_fixed_scope_without_its_rows_or_a_scope_without_a_window_is_refused(
    auth_client, observe_project, scope_view, insight_enabled
):
    fixed = auth_client.post(
        RUNS,
        {
            "project_id": str(observe_project.id),
            "config": report(),
            "scope": {"label": "12 selected sessions", "preset": "fixed"},
        },
        format="json",
    )
    assert fixed.status_code == status.HTTP_400_BAD_REQUEST
    assert "handed over" in fixed.json()["message"]
    no_window = auth_client.post(
        RUNS,
        {
            "project_id": str(observe_project.id),
            "config": report(),
            "scope": {"filters": [ERRORED]},
        },
        format="json",
    )
    assert no_window.status_code == status.HTTP_400_BAD_REQUEST
    assert "date range" in no_window.json()["message"]
    assert not InsightConfig.objects.filter(project=observe_project).exists()


@pytest.mark.django_db
def test_a_users_report_reads_the_users_views_search_and_filters(
    auth_client, observe_project, scope_view, insight_enabled
):
    more_sessions = {
        "column_id": "num_sessions",
        "filter_config": {
            "filter_type": "number",
            "filter_op": "greater_than",
            "filter_value": 2,
        },
    }
    response = auth_client.post(
        RUNS,
        {
            "project_id": str(observe_project.id),
            "config": report("users"),
            "scope": {"filters": [more_sessions], "window": WINDOW, "search": "acme"},
            "sample_size": 20,
        },
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK, response.json()
    asked = scope_view["count"][-1]
    assert asked["unit"] == "users" and asked["search"] == "acme"
    assert asked["filters"][0]["column_id"] == "num_sessions"
    assert scope_view["pick"][-1]["search"] == "acme"

    sessions_search = auth_client.post(
        ESTIMATE,
        {
            "project_id": str(observe_project.id),
            "unit": "sessions",
            "scope": {"window": WINDOW, "search": "acme"},
        },
        format="json",
    )
    assert sessions_search.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_a_scope_the_server_cant_read_says_so(
    auth_client, observe_project, monkeypatch
):
    def unavailable(*args, **kwargs):
        raise rows_service.PopulationUnavailable("These filters can't be read.")

    monkeypatch.setattr(users_service, "count_view", unavailable)
    response = auth_client.post(
        ESTIMATE,
        {
            "project_id": str(observe_project.id),
            "unit": "traces",
            "scope": {"window": WINDOW},
        },
        format="json",
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert response.json()["message"] == "These filters can't be read."


@pytest.mark.django_db
def test_earlier_insights_date_options_read_as_observes(
    auth_client, observe_project, organization, workspace, user
):
    for preset in ["7d", "30d", "24h", "fixed", "3M"]:
        InsightConfig.objects.create(
            project=observe_project,
            organization=organization,
            workspace=workspace,
            created_by=user,
            name=f"Report {preset}",
            unit="sessions",
            lens="failures",
            question="Where is the agent failing?",
            scope={"preset": preset, "window": WINDOW, "label": "Past 7 days"},
        )
    configs = auth_client.get(CONFIGS, {"project_id": str(observe_project.id)}).json()[
        "result"
    ]["configs"]
    presets = {c["name"]: c["scope"]["preset"] for c in configs}
    assert presets == {
        "Report 7d": "7D",
        "Report 30d": "30D",
        "Report 24h": "24h",
        "Report fixed": "fixed",
        "Report 3M": "3M",
    }


@pytest.mark.django_db
def test_an_unknown_date_option_is_refused(auth_client, observe_project, scope_view):
    response = auth_client.post(
        ESTIMATE,
        {
            "project_id": str(observe_project.id),
            "unit": "sessions",
            "scope": {"window": WINDOW, "preset": "fortnight"},
        },
        format="json",
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_a_users_estimate_names_its_first_users_while_still_counting(
    auth_client, observe_project, monkeypatch
):
    ids = [str(uuid.uuid4()) for _ in range(30)]
    monkeypatch.setattr(
        users_service,
        "count_view",
        lambda *a, **k: rows_service.Population(5, True, WINDOW_FROM, WINDOW_TO, []),
    )
    picks = []

    def pick(project_id, unit, filters, *, n, after, search=None, budget_s=None):
        picks.append({"unit": unit, "n": n, "search": search, "budget_s": budget_s})
        return [(i, h) for h, i in enumerate(ids[:n])]

    monkeypatch.setattr(users_service, "pick_view", pick)
    more_sessions = {
        "column_id": "num_sessions",
        "filter_config": {
            "filter_type": "number",
            "filter_op": "greater_than",
            "filter_value": 2,
        },
    }
    response = auth_client.post(
        ESTIMATE,
        {
            "project_id": str(observe_project.id),
            "unit": "users",
            "scope": {"filters": [more_sessions], "window": WINDOW, "search": "acme"},
        },
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK, response.json()
    result = response.json()["result"]
    assert result["population_is_lower_bound"] is True
    # The pick walks to its 20th user however far the count has got.
    assert result["sample_ids"] == ids[:20]
    assert picks == [
        {
            "unit": "users",
            "n": 20,
            "search": "acme",
            "budget_s": users_service.estimate_budget_s(),
        }
    ]
