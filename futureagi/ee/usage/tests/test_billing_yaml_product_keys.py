"""billing.yaml defines every key product code bills or gates on.

Nothing fails loudly when one is missing. check_usage allows an event type
billing.yaml doesn't list and the billing consumer drops its events, so the
usage goes unbilled and the credit cap checks nothing. A capability's Cloud
entitlement (``has_<feature>``) that isn't there resolves to False, so every
Cloud org loses the feature. These tests load the real file through
BillingConfig and look the keys up.

billing.yaml ships only with the private cloud overlay (future-agi/ee checked
out at ee/cloud/), so the module skips without it, as test_billing_config.py
does. Backend CI's internal runs check that repo out on the branch named like
the PR's head, else its base, else dev, and run it there.
"""

import os

import pytest
from django.conf import settings

from ee.agenthub.insights import billing as insights_billing
from ee.usage.schemas.event_types import BillingEventType
from ee.usage.services.config import BillingConfig
from tfc.capabilities.registry import (
    FEATURE_INSIGHTS,
    FEATURE_INSTANT_EVAL,
    FEATURE_JEV_MODELS,
    FEATURE_REGISTRY,
)

pytestmark = [
    pytest.mark.requires_ee,
    pytest.mark.skipif(
        not os.path.exists(
            getattr(
                settings,
                "BILLING_CONFIG_PATH",
                os.path.join(settings.BASE_DIR, "billing.yaml"),
            )
        ),
        reason="billing.yaml ships only with the private cloud overlay",
    ),
]

# What Jev evaluations (ee/jev/metering.py) and Insights reports
# (ee/agenthub/insights/billing.py) emit and check credits against.
CREDIT_EVENTS = [BillingEventType.JEV_EVALUATOR.value, insights_billing.EVENT]

# On Cloud a capability is the plan entitlement ``has_<id>``
# (ee/usage/services/entitlements.py _CloudPlanResolver), read for every
# feature that isn't OSS baseline (tfc/capabilities/service.py check).
CLOUD_GATED = sorted(f.id for f in FEATURE_REGISTRY.values() if not f.oss_baseline)


@pytest.fixture(scope="module")
def billing():
    return BillingConfig.reload()


@pytest.mark.parametrize("event_type", list(BillingEventType), ids=lambda e: e.value)
def test_every_event_type_is_an_api_call_type(billing, event_type):
    assert event_type.value in billing.get_all_call_types()


@pytest.mark.parametrize("event_type", CREDIT_EVENTS)
def test_jev_and_insights_events_are_charged_in_ai_credits(billing, event_type):
    assert billing.get_call_type(event_type).dimension == "ai_credits"


def test_jev_instant_eval_and_insights_are_cloud_gated():
    assert {
        FEATURE_JEV_MODELS.id,
        FEATURE_INSTANT_EVAL.id,
        FEATURE_INSIGHTS.id,
    } <= set(CLOUD_GATED)


@pytest.mark.parametrize("feature_id", CLOUD_GATED)
def test_every_cloud_gated_capability_is_a_boolean_entitlement_on_every_plan(
    billing, feature_id
):
    # Entitlements.has_feature treats anything but a bool as not included.
    values = {
        plan: billing.get_entitlement_default(f"has_{feature_id}", plan)
        for plan in billing.get_all_plans()
    }
    assert values
    assert all(isinstance(value, bool) for value in values.values()), values
