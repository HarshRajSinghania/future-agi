import json

import pytest

from ee.agenthub.analyse import discovery
from ee.agenthub.analyse.discovery import (
    DiscoveryError,
    SampledTrace,
    build_messages,
    parse_proposal,
)

SAMPLE = [
    SampledTrace("t1", "Where is my order HP-1? It is late.", "It ships Friday."),
    SampledTrace("t2", "I want a refund for order HP-2.", "Refund issued."),
    SampledTrace("t3", "Cancel order HP-3 please.", "Cancelled."),
    SampledTrace("t4", "Is the vest waterproof?", "Yes, it is."),
]


def proposal(**overrides):
    body = {
        "question": "Why is the customer contacting support?",
        "categories": [
            {
                "label": "Order Tracking",
                "definition": "Asks where an order is.",
                "examples": [{"id": 1, "quote": "Where is my order HP-1?"}],
            },
            {
                "label": "Refunds",
                "definition": "Wants money back.",
                "examples": [{"id": 2, "quote": "I want a refund"}],
            },
        ],
        "assignments": {"1": "Order Tracking", "2": "Refunds", "3": "Other"},
    }
    body.update(overrides)
    return json.dumps(body)


def test_counts_sample_assignments_and_keeps_verbatim_quotes():
    result = parse_proposal(proposal(), SAMPLE, "m")
    assert [c["label"] for c in result.categories] == ["Order Tracking", "Refunds"]
    assert [c["sample_count"] for c in result.categories] == [1, 1]
    # Trace 3 went to Other and trace 4 was never assigned.
    assert result.unassigned == 2
    assert result.categories[0]["examples"] == [
        {"trace_id": "t1", "quote": "Where is my order HP-1?"}
    ]
    assert result.dropped_quotes == 0


def test_drops_quotes_that_are_not_in_the_cited_trace():
    body = proposal()
    data = json.loads(body)
    data["categories"][0]["examples"] = [
        {"id": 1, "quote": "My parcel never arrived"},
        {"id": 99, "quote": "Where is my order"},
        {"id": 2, "quote": "Where is my order HP-1?"},
    ]
    result = parse_proposal(json.dumps(data), SAMPLE, "m")
    assert result.categories[0]["examples"] == []
    assert result.dropped_quotes == 3


def test_ignores_other_duplicates_and_reads_fenced_json():
    data = json.loads(proposal())
    data["categories"].append({"label": "other", "definition": "x"})
    data["categories"].append({"label": "refunds", "definition": "dup"})
    result = parse_proposal(f"```json\n{json.dumps(data)}\n```", SAMPLE, "m")
    assert [c["label"] for c in result.categories] == ["Order Tracking", "Refunds"]


def test_rejects_proposals_without_distinct_categories():
    data = json.loads(proposal())
    data["categories"] = data["categories"][:1]
    with pytest.raises(DiscoveryError):
        parse_proposal(json.dumps(data), SAMPLE, "m")
    with pytest.raises(DiscoveryError):
        parse_proposal("not json at all", SAMPLE, "m")


def test_prompt_clips_long_traces_and_numbers_them():
    long = SampledTrace("t9", "x" * 5000, "y" * 5000)
    content = build_messages("Why do users churn?", [long])[1]["content"]
    assert "Why do users churn?" in content
    assert "[1] INPUT:" in content
    assert len(content) < 2000


def test_needs_enough_readable_traces(monkeypatch):
    monkeypatch.setattr(discovery, "load_sample", lambda *_: SAMPLE)
    with pytest.raises(DiscoveryError, match="at least"):
        discovery.discover_categories("p1", ["t1", "t2", "t3", "t4"])


def test_model_failures_become_a_safe_message(monkeypatch):
    monkeypatch.setattr(discovery, "load_sample", lambda *_: SAMPLE * 3)

    def boom(*_):
        raise RuntimeError("upstream 401 with secret details")

    monkeypatch.setattr(discovery, "_call_model", boom)
    with pytest.raises(DiscoveryError) as excinfo:
        discovery.discover_categories("p1", ["t1"] * 12)
    assert "secret" not in str(excinfo.value)
