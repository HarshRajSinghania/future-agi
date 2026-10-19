"""Insights billing: model calls are priced (the gateway's figure, else the
model's token price), a written report is charged once as AI credits, and
the credit cap refuses a report, a question, a draft or a preview up front."""

import pytest
from rest_framework import status

from ee.agenthub.insights import billing, llm, pipeline
from ee.usage.schemas.events import CheckResult
from tracer.models.insights import InsightRun
from tracer.tests.test_insights_api import RUNS, insight_enabled, new_run_body  # noqa: F401
from tracer.views import insights as views


@pytest.fixture
def started(request):
    """Runs the view handed to Temporal (the API tests' autouse stub)."""
    return request.getfixturevalue("insight_enabled")


@pytest.fixture
def emitted(monkeypatch):
    events = []
    monkeypatch.setattr("ee.usage.services.emitter.emit", events.append)
    return events


@pytest.fixture
def refuse(monkeypatch):
    """Billing refuses whatever is checked, with ``left`` credits left."""

    def set_refusal(error_code="FREE_TIER_LIMIT", left=0.0):
        checked = []

        def check_usage(org_id, event_type, amount=1):
            checked.append((event_type, amount))
            return CheckResult(
                allowed=False,
                error_code=error_code,
                reason="refused",
                current_usage=100 - left,
                limit=100,
            )

        monkeypatch.setattr("ee.usage.services.metering.check_usage", check_usage)
        return checked

    return set_refusal


class TestPricing:
    def test_the_gateway_figure_wins(self):
        assert llm.call_cost("turing_flash", 0.0123, 1000, 100) == 0.0123

    def test_a_zero_from_the_gateway_falls_back_to_the_token_price(self):
        priced = llm.call_cost("turing_flash", 0.0, 1_000_000, 100_000)
        assert priced > 0
        assert priced == llm.call_cost("turing_flash", 0.0, 1_000_000, 100_000)

    def test_no_tokens_or_no_model_costs_nothing(self):
        assert llm.call_cost("turing_flash", 0.0, 0, 0) == 0.0
        assert llm.call_cost("", 0.0, 500, 50) == 0.0

    def test_a_reply_that_isnt_json_is_still_counted(self, monkeypatch):
        replies = iter([("not json", 0.01, 10, 5), ('{"ok": true}', 0.02, 20, 6)])
        monkeypatch.setattr(llm, "_complete", lambda *a: next(replies))
        monkeypatch.setattr(llm.time, "sleep", lambda *_: None)
        spend = llm.Spend()
        assert llm.chat_json("s", "u", tier=llm.FAST, spend=spend) == {"ok": True}
        assert spend.calls == 2
        assert spend.cost_usd == pytest.approx(0.03)
        assert (spend.prompt_tokens, spend.completion_tokens) == (30, 11)

    def test_the_agent_reports_tokens_when_it_has_no_cost(self, monkeypatch):
        from ee.agenthub.insights import agent

        class Reply:
            status_code = 200

            @staticmethod
            def json():
                return {"usage": {"model": "turing_large", "prompt_tokens": 4000,
                                  "completion_tokens": 900, "cost_usd": 0}}

        monkeypatch.setattr(agent, "_setting", lambda name: "http://agent" if "URL" in name else "x")
        monkeypatch.setattr(agent.httpx, "post", lambda *a, **k: Reply())
        spend = llm.Spend()
        agent._post("/v1/ask", {}, spend)
        assert spend.cost_usd == llm.call_cost("turing_large", 0.0, 4000, 900) > 0


class TestCharging:
    def test_credits_follow_billings_conversion_and_nothing_spent_is_free(self):
        from ee.usage.services.config import BillingConfig

        assert billing.credits(0) == 0.0
        assert billing.credits(0.05) == pytest.approx(
            BillingConfig.get().calculate_ai_credits(0.05), abs=1e-4
        )

    @pytest.mark.django_db
    def test_a_written_report_is_charged_once_under_a_stable_id(
        self, auth_client, observe_project, emitted
    ):
        response = auth_client.post(RUNS, new_run_body(observe_project), format="json")
        run = InsightRun.objects.get(id=response.json()["result"]["run_id"])
        run.cost_usd = 0.42
        assert billing.charge_run(run) == billing.credits(0.42)
        billing.charge_run(run)
        assert len(emitted) == 2
        first, again = emitted
        assert first.event_type == "insights_report"
        assert first.org_id == str(run.organization_id)
        assert first.amount == billing.credits(0.42)
        assert first.properties["source"] == "insights_report"
        assert first.properties["raw_cost_usd"] == "0.42"
        # A retried finish re-emits the same id; the consumer bills it once.
        assert first.event_id == again.event_id

    @pytest.mark.django_db
    def test_a_report_that_spent_nothing_is_not_charged(
        self, auth_client, observe_project, emitted
    ):
        response = auth_client.post(RUNS, new_run_body(observe_project), format="json")
        run = InsightRun.objects.get(id=response.json()["result"]["run_id"])
        assert billing.charge_run(run) == 0.0
        assert emitted == []

    @pytest.mark.django_db
    def test_finishing_a_report_charges_it_and_failing_one_does_not(
        self, auth_client, observe_project, emitted, monkeypatch
    ):
        response = auth_client.post(RUNS, new_run_body(observe_project), format="json")
        run_id = response.json()["result"]["run_id"]
        InsightRun.objects.filter(id=run_id).update(cost_usd=0.3)

        def write(run, result, units, contents, spend):
            spend.add(0.1)
            return {"title": "t", "findings": [], "key_points": [], "highlights": [],
                    "examples": []}

        monkeypatch.setattr(pipeline.report, "write", write)
        pipeline.finish(run_id)
        run = InsightRun.objects.get(id=run_id)
        assert run.status == "completed"
        assert [e.amount for e in emitted] == [billing.credits(0.4)]

        emitted.clear()
        pipeline.fail(run_id, "boom")
        assert emitted == []


class TestCreditCap:
    @pytest.mark.django_db
    def test_a_report_over_the_cap_is_refused_before_it_starts(
        self, auth_client, observe_project, started, refuse
    ):
        checked = refuse(left=0.0)
        response = auth_client.post(
            RUNS, new_run_body(observe_project, n=30, sample_size=10), format="json"
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        body = response.json()
        assert body["code"] == "insights_credits"
        detail = body["result"]
        assert detail["error_code"] == "FREE_TIER_LIMIT"
        assert detail["credits_estimate"] == billing.credits(billing.run_cost(10))
        assert detail["credits_left"] == 0.0
        assert "you have none left this month" in detail["message"]
        assert checked == [("insights_report", billing.credits(billing.run_cost(10)))]
        assert not InsightRun.objects.exists()
        assert started == []

    @pytest.mark.django_db
    def test_the_refusal_names_the_largest_sample_that_fits(
        self, auth_client, observe_project, started, refuse
    ):
        left = billing.credits(billing.run_cost(200)) + 1e-3
        refuse(left=left)
        response = auth_client.post(
            RUNS, new_run_body(observe_project, n=900, sample_size=800), format="json"
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        detail = response.json()["result"]
        assert detail["sample_size"] >= 200
        assert billing.credits(billing.run_cost(detail["sample_size"])) <= left
        assert f"A sample of up to {detail['sample_size']:,} sessions fits." in detail["message"]

    @pytest.mark.django_db
    def test_unpaid_invoices_refuse_with_402(
        self, auth_client, observe_project, started, refuse
    ):
        refuse(error_code="PAYMENT_REQUIRED")
        response = auth_client.post(RUNS, new_run_body(observe_project), format="json")
        assert response.status_code == status.HTTP_402_PAYMENT_REQUIRED
        assert "unpaid invoices" in response.json()["result"]["message"]

    @pytest.mark.django_db
    def test_without_billing_a_report_starts(
        self, auth_client, observe_project, started, monkeypatch
    ):
        def unavailable(*a, **k):
            raise RuntimeError("no billing redis here")

        monkeypatch.setattr("ee.usage.services.metering.check_usage", unavailable)
        response = auth_client.post(RUNS, new_run_body(observe_project), format="json")
        assert response.status_code == status.HTTP_200_OK
        assert len(started) == 1


@pytest.mark.django_db
def test_a_question_is_checked_then_charged_and_added_to_the_run(
    auth_client, observe_project, emitted, refuse, monkeypatch
):
    response = auth_client.post(RUNS, new_run_body(observe_project), format="json")
    run_id = response.json()["result"]["run_id"]
    InsightRun.objects.filter(id=run_id).update(
        status="completed", cost_usd=0.5, result={"categories": [{"id": "a"}]}
    )

    def answer(run, result, units, contents, question, history, spend):
        spend.add(0.02)
        return {"answer": [], "follow_ups": []}

    monkeypatch.setattr("ee.agenthub.insights.report.answer", answer)
    ask = f"{RUNS}{run_id}/ask/"
    assert auth_client.post(ask, {"question": "why?"}, format="json").status_code == 200
    assert [(e.properties["source"], e.amount) for e in emitted] == [
        ("insights_ask", billing.credits(0.02))
    ]
    assert InsightRun.objects.get(id=run_id).cost_usd == pytest.approx(0.52)

    refuse(left=0.0)
    refused = auth_client.post(ask, {"question": "and?"}, format="json")
    assert refused.status_code == status.HTTP_403_FORBIDDEN
    assert refused.json()["result"]["message"].startswith("This question needs about")


def test_the_estimate_carries_the_credit_fields(monkeypatch, refuse):
    class Org:
        id = "org-1"

    assert views._credit_estimate(Org(), 0, "sessions")["credits_estimate"] == 0.0
    refuse(left=0.0)
    out = views._credit_estimate(Org(), 300, "sessions")
    assert out["credits_estimate"] == billing.credits(billing.run_cost(300)) > 0
    assert out["credit_limited"] is True
    assert out["credits_left"] == 0.0
    assert out["credit_max_sample"] is None
    assert "This report needs about" in out["credit_message"]
