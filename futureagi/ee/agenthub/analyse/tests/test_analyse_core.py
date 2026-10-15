"""Analyse pipeline pieces that don't need a database: statistics, facet
validation, clustering, summary verification and sampling."""

import numpy as np
import pytest

from ee.agenthub.analyse import clustering, llm, summary
from ee.agenthub.analyse.facets import clean_attributes, included, normalise
from ee.agenthub.analyse.pipeline import sample_evenly
from ee.agenthub.analyse.stats import benjamini_hochberg, measure, wilson


def unit(key, *, failure=False, outcome="resolved", sentiment=4, latency=1000, user=None,
         category="top", sub="sub", errors=0):
    return {
        "key": str(key),
        "unit_id": f"u{key}",
        "user_id": user or f"user{key}",
        "session_id": f"s{key}",
        "time": "2026-10-14T10:00:00",
        "summary": f"summary {key}",
        "facets": {
            "failure_present": failure,
            "outcome": outcome,
            "sentiment": sentiment,
            "attributes": {},
        },
        "metrics": {"latency_ms": latency, "errors": errors, "turns": 3, "cost": 0.01},
        "category_id": category,
        "sub_category_id": sub,
    }


class TestStatistics:
    def test_wilson_interval_brackets_the_rate(self):
        low, high = wilson(30, 100)
        assert low < 0.3 < high
        assert wilson(0, 0) == (0.0, 0.0)

    def test_benjamini_hochberg_is_monotone_and_never_below_p(self):
        p = [0.001, 0.04, 0.03, 0.5]
        q = benjamini_hochberg(p)
        assert all(qi >= pi for pi, qi in zip(p, q, strict=True))
        order = sorted(range(4), key=lambda i: p[i])
        assert [q[i] for i in order] == sorted(q)

    def test_a_category_that_fails_far_more_is_notable(self):
        bad = [unit(i, failure=True, outcome="unresolved", sentiment=1, category="a", sub="a1")
               for i in range(20)]
        good = [unit(100 + i, category="b", sub="b1") for i in range(40)]
        tops = [{"id": "a", "name": "A", "level": 1}, {"id": "b", "name": "B", "level": 1}]
        subs = [{"id": "a1", "name": "A1", "level": 2, "parent_id": "a"},
                {"id": "b1", "name": "B1", "level": 2, "parent_id": "b"}]
        result = measure(bad + good, tops, subs, [])
        by_id = {c["id"]: c for c in result["categories"]}
        assert by_id["a"]["stats"]["count"] == 20
        assert by_id["a"]["stats"]["share"] == pytest.approx(20 / 60)
        assert by_id["a"]["stats"]["failure_rate"] == 1.0
        metrics = {n["metric"] for n in by_id["a"]["notable"]}
        assert {"failure", "unresolved", "negative"} <= metrics
        assert result["totals"]["count"] == 60

    def test_small_or_equal_groups_produce_no_claims(self):
        units = [unit(i, category="a" if i % 2 else "b", sub="a1" if i % 2 else "b1")
                 for i in range(10)]
        tops = [{"id": "a", "level": 1}, {"id": "b", "level": 1}]
        subs = [{"id": "a1", "level": 2, "parent_id": "a"}, {"id": "b1", "level": 2, "parent_id": "b"}]
        result = measure(units, tops, subs, [])
        assert all(not c["notable"] for c in result["categories"])


class TestFacets:
    def test_normalise_clamps_and_drops_malformed_values(self):
        attrs = clean_attributes([{"key": "Asked For Human", "type": "boolean"}])
        facets = normalise(
            {"summary": "  a\n b ", "lens_answer": "x", "outcome": "Partially Resolved",
             "sentiment": "9", "broke_at_turn": "two", "attributes": {"asked_for_human": "yes"}},
            attrs,
        )
        assert facets["summary"] == "a b"
        assert facets["outcome"] == "partially_resolved"
        assert facets["sentiment"] == 5
        assert facets["broke_at_turn"] is None
        assert facets["attributes"] == {"asked_for_human": True}
        assert normalise("not a dict", [])["outcome"] == "unclear"

    def test_clean_attributes_dedupes_caps_and_limits_filters_to_booleans(self):
        raw = [{"key": "a", "type": "number", "filter_by": True}, {"key": "a"}] + [
            {"key": f"k{i}"} for i in range(20)
        ]
        cleaned = clean_attributes(raw)
        assert len(cleaned) == 8
        assert cleaned[0] == {"key": "a", "description": "", "type": "number", "filter_by": False}

    def test_lens_and_filter_attributes_decide_inclusion(self):
        attrs = [{"key": "refund", "type": "boolean", "filter_by": True}]
        assert not included({"lens_answer": "none", "attributes": {}}, "failures", [])
        assert not included({"lens_answer": "Not applicable.", "attributes": {}}, "custom", [])
        assert not included({"lens_answer": "x", "attributes": {"refund": False}}, "usage", attrs)
        assert included({"lens_answer": "x", "attributes": {"refund": True}}, "usage", attrs)


class TestClustering:
    def test_cluster_count_grows_with_square_root(self):
        assert clustering.base_cluster_count(5) == 1
        assert clustering.base_cluster_count(100) == 10
        assert clustering.base_cluster_count(10_000) == 30

    def test_small_clusters_are_dissolved_into_neighbours(self):
        rng = np.random.default_rng(0)
        a = rng.normal(0, 0.05, (20, 4)) + [1, 0, 0, 0]
        b = rng.normal(0, 0.05, (20, 4)) + [0, 1, 0, 0]
        stray = np.array([[0, 0, 1, 0]])
        labels = clustering.kmeans(np.vstack([a, b, stray]), 3, min_size=3)
        sizes = np.bincount(labels)
        assert sizes.min() >= 3
        assert len(set(labels[:20])) == 1 and len(set(labels[20:40])) == 1

    def test_discover_names_clusters_and_builds_a_hierarchy(self, monkeypatch):
        from agentic_eval.core.embeddings import serving_client

        monkeypatch.setattr(serving_client, "serving_available", lambda: False)

        def fake_chat(system, prompt, *, tier, **_):
            if "Subcategories:" in prompt:
                ids = [line.split('"')[1] for line in prompt.splitlines() if line.startswith('- id "')]
                return {"categories": [
                    {"name": "Orders", "description": "d", "children": ids[: len(ids) // 2]},
                    {"name": "Accounts", "description": "d", "children": ids[len(ids) // 2 :]},
                ]}
            return {"name": f"Group {abs(hash(prompt)) % 1000}", "description": "about"}

        monkeypatch.setattr(clustering, "chat_json", fake_chat)
        texts = [f"agent asked for the order number again {i}" for i in range(30)] + [
            f"agent changed the account email without checks {i}" for i in range(30)
        ] + [f"agent made up stock levels and shipping dates {i}" for i in range(30)]
        items = [clustering.Item(key=str(i), text=t) for i, t in enumerate(texts)]
        tops, subs, info = clustering.discover(items, context="ctx", spend=llm.Spend())
        assert info["method"] == "tfidf"
        assert sum(len(s.members) for s in subs) == len(items)
        assert {s.parent_id for s in subs} <= {t.id for t in tops}

    def test_classify_maps_unknown_answers_to_none(self, monkeypatch):
        monkeypatch.setattr(
            clustering, "chat_json",
            lambda *a, **k: {"assignments": {"1": "s1", "2": "made-up", "3": "none"}},
        )
        items = [clustering.Item(key=k, text="t") for k in ("a", "b", "c")]
        out = clustering.classify(items, [{"id": "s1", "name": "S", "description": ""}],
                                  context="", spend=llm.Spend())
        assert out == {"a": "s1", "b": clustering.NONE, "c": clustering.NONE}


class TestSummary:
    def test_findings_with_numbers_that_are_not_in_the_stats_are_dropped(self, monkeypatch):
        result = {
            "totals": {"count": 40, "users": 30, "sessions": 40},
            "population_size": 108,
            "sample_size": 108,
            "categories": [{
                "id": "a", "name": "A", "level": 1, "description": "d", "has_children": False,
                "stats": {"count": 10, "users": 8, "sessions": 10, "turns": 30, "share": 0.25,
                          "failure_rate": 1.0, "unresolved_rate": 0.5, "error_rate": 0.0,
                          "outcomes": {"unresolved": 5}},
                "notable": [],
            }],
        }
        units = {"a": [{"key": "1", "unit_id": "trace-1", "summary": "s", "facets": {"sentiment": 1}}]}
        monkeypatch.setattr(summary, "chat_json", lambda *a, **k: {
            "title": "T",
            "key_points": [
                {"text": "A is 25% of 40 conversations (#1).", "category_ids": ["a", "zzz"]},
                {"text": "A grew 73% this week.", "category_ids": ["a"]},
            ],
            "highlights": [{"ref": 1, "reason": "r"}, {"ref": 9, "reason": "bad ref"}],
        })
        out = summary.write_summary(question="q", unit="sessions", agent_description="",
                                    result=result, units_by_category=units, spend=llm.Spend())
        assert [p["text"] for p in out["key_points"]] == ["A is 25% of 40 conversations (#1)."]
        assert out["key_points"][0]["category_ids"] == ["a"]
        # Citations point at the real trace/session id, not the internal row key.
        assert out["key_points"][0]["refs"] == [{"ref": 1, "unit_id": "trace-1"}]
        assert out["dropped_points"] == 1
        assert [h["unit_id"] for h in out["highlights"]] == ["trace-1"]


class TestModelCalls:
    def test_a_truncated_reply_is_retried_with_more_room(self, monkeypatch):
        budgets = []

        def fake_complete(messages, model, max_tokens, temperature):
            budgets.append(max_tokens)
            return ('{"summary": "cut' if len(budgets) == 1 else '{"ok": true}'), 0.0

        monkeypatch.setattr(llm, "_complete", fake_complete)
        monkeypatch.setattr(llm.time, "sleep", lambda *_: None)
        assert llm.chat_json("s", "u", tier=llm.FAST, max_tokens=700) == {"ok": True}
        assert budgets == [700, 1400]

    def test_persistent_failure_raises_a_safe_retryable_error(self, monkeypatch):
        def boom(*_):
            raise RuntimeError("provider exploded with internals")

        monkeypatch.setattr(llm, "_complete", boom)
        monkeypatch.setattr(llm.time, "sleep", lambda *_: None)
        with pytest.raises(llm.AnalyseModelError) as caught:
            llm.chat_json("s", "u", tier=llm.FAST)
        assert caught.value.unavailable
        assert "internals" not in str(caught.value)


class TestSampling:
    def test_even_sample_spans_the_window(self):
        population = [{"id": str(i), "time": f"2026-10-{i + 1:02d}"} for i in range(20)]
        picked = sample_evenly(list(reversed(population)), 5)
        assert [p["id"] for p in picked][0] == "0" and picked[-1]["id"] == "19"
        assert len(picked) == 5
        assert sample_evenly(population, 1) == [population[-1]]
        assert sample_evenly(population[:3], 10) == population[:3]
