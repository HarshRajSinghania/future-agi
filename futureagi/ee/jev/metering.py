"""Attempt-stable usage events for completed Jev evaluations.

TypeSafe bills Jev input tokens at $0.042 per million tokens; output tokens
are free. The platform markup is applied by ``BillingConfig`` when converting
this pre-markup cost to credits.
"""

import uuid
from decimal import Decimal

from ee.jev.mapping import mapping_revision
from ee.jev.models import JEV_PROVIDER, JEV_SERVICE
from ee.usage.schemas.event_types import BillingEventType
from ee.usage.schemas.events import UsageEvent

# The billing consumer stores event_id as a UUID; uuid5 keeps the id stable
# across redelivery of the same attempt.
_EVENT_ID_NAMESPACE = uuid.UUID("5d7c6a3e-2f4b-4a1e-9c8d-6b0e1f2a3c4d")

JEV_INPUT_USD_PER_MILLION_TOKENS = Decimal("0.042")


def calculate_actual_cost(usage):
    """Return TypeSafe's pre-markup USD cost for one response."""
    try:
        input_tokens = max(0, int((usage or {}).get("input_tokens", 0) or 0))
    except (TypeError, ValueError):
        input_tokens = 0
    return (Decimal(input_tokens) * JEV_INPUT_USD_PER_MILLION_TOKENS) / Decimal(
        "1000000"
    )


def usage_event_id(cell_or_run_id, attempt):
    return str(uuid.uuid5(_EVENT_ID_NAMESPACE, f"jev:{cell_or_run_id}:{attempt}"))


def build_usage_events(evaluator, *, org_id, cell_or_run_id, amount, attempt_offset=0):
    """Preserve token units for each attempt; apply the existing fee once."""
    actual = evaluator.last_jev or {}
    events = []
    for record in evaluator.client.attempts:
        attempt = attempt_offset + record["attempt"]
        success = record["outcome"] == "success"
        usage = record.get("usage") or {}
        actual_cost = calculate_actual_cost(usage)
        events.append(
            UsageEvent(
                event_id=usage_event_id(cell_or_run_id, attempt),
                org_id=str(org_id),
                event_type=BillingEventType.JEV_EVALUATOR.value,
                amount=amount if success else 0,
                properties={
                    "provider": JEV_PROVIDER,
                    "service": JEV_SERVICE,
                    "requested_model": evaluator._model,
                    "actual_model": actual.get("actual_model") if success else None,
                    "mapping_revision": mapping_revision(evaluator.mapping),
                    "input_tokens": usage.get("input_tokens", 0),
                    "output_tokens": usage.get("output_tokens", 0),
                    "raw_cost_usd": str(actual_cost),
                    "attempt": attempt,
                    "outcome": record["outcome"],
                },
            )
        )
    return events
