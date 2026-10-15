"""Per-category statistics for an Analyse report.

Every category gets counts in all three units (items, sessions, users), its
outcome mix, sentiment, failure and error rates, latency and cost, attribute
summaries and a day-by-day series. Each category is also compared with the
rest of the analysed items: a difference is called "notable" only when it is
large enough to matter and survives a Benjamini-Hochberg correction across
every test in the report, so small clusters don't produce confident claims.
"""

from __future__ import annotations

import math
import statistics
from collections import Counter

from scipy.stats import fisher_exact, mannwhitneyu

Q_THRESHOLD = 0.1
MIN_LIFT = 1.5
MIN_DELTA = 0.33
MIN_GROUP = 4

BINARY_METRICS = {
    "failure": ("had an agent failure", lambda u: bool(u["facets"].get("failure_present"))),
    "unresolved": (
        "ended unresolved or abandoned",
        lambda u: u["facets"].get("outcome") in ("unresolved", "abandoned"),
    ),
    "negative": (
        "had a negative user sentiment",
        lambda u: (u["facets"].get("sentiment") or 3) <= 2,
    ),
    "error": ("hit an error", lambda u: (u["metrics"].get("errors") or 0) > 0),
    "escalated": ("were escalated", lambda u: u["facets"].get("outcome") == "escalated"),
}
NUMERIC_METRICS = {
    "latency_ms": ("median latency", lambda u: u["metrics"].get("latency_ms")),
    "turns": ("turns", lambda u: u["metrics"].get("turns")),
    "sentiment": ("sentiment", lambda u: u["facets"].get("sentiment")),
    "cost": ("cost", lambda u: u["metrics"].get("cost")),
}


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return 0.0, 0.0
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def benjamini_hochberg(pvalues: list[float]) -> list[float]:
    order = sorted(range(len(pvalues)), key=lambda i: pvalues[i])
    adjusted = [1.0] * len(pvalues)
    running = 1.0
    for rank in range(len(order), 0, -1):
        i = order[rank - 1]
        running = min(running, pvalues[i] * len(order) / rank)
        adjusted[i] = running
    return adjusted


def cliffs_delta(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    greater = sum(1 for x in a for y in b if x > y)
    less = sum(1 for x in a for y in b if x < y)
    return (greater - less) / (len(a) * len(b))


def _attribute_summary(units: list[dict], attributes: list[dict]) -> dict:
    out = {}
    for attribute in attributes:
        values = [u["facets"].get("attributes", {}).get(attribute["key"]) for u in units]
        values = [v for v in values if v is not None]
        if not values:
            continue
        if attribute["type"] == "boolean":
            out[attribute["key"]] = {"type": "boolean", "rate": sum(1 for v in values if v) / len(values), "n": len(values)}
        elif attribute["type"] == "number":
            out[attribute["key"]] = {"type": "number", "mean": statistics.fmean(values), "n": len(values)}
        else:
            top = Counter(values).most_common(5)
            out[attribute["key"]] = {"type": "string", "top": [{"value": v, "count": c} for v, c in top], "n": len(values)}
    return out


def describe(units: list[dict], attributes: list[dict]) -> dict:
    """Counts and descriptive stats for a group of analysed units."""
    users = {u["user_id"] for u in units if u.get("user_id")}
    sessions = {u["session_id"] for u in units if u.get("session_id")}
    outcomes = Counter(u["facets"].get("outcome", "unclear") for u in units)
    sentiments = [u["facets"]["sentiment"] for u in units if u["facets"].get("sentiment")]
    latencies = [u["metrics"]["latency_ms"] for u in units if u["metrics"].get("latency_ms")]
    costs = [u["metrics"].get("cost") or 0 for u in units]
    turns = [u["metrics"].get("turns") or 0 for u in units]
    daily = Counter(u["time"][:10] for u in units if u.get("time"))
    n = len(units) or 1
    return {
        "count": len(units),
        "users": len(users),
        "sessions": len(sessions),
        "turns": sum(turns),
        "outcomes": dict(outcomes),
        "sentiment": round(statistics.fmean(sentiments), 2) if sentiments else None,
        "failure_rate": sum(1 for u in units if u["facets"].get("failure_present")) / n,
        "unresolved_rate": sum(1 for u in units if u["facets"].get("outcome") in ("unresolved", "abandoned")) / n,
        "error_rate": sum(1 for u in units if (u["metrics"].get("errors") or 0) > 0) / n,
        "latency_ms": statistics.median(latencies) if latencies else None,
        "cost": round(statistics.fmean(costs), 6) if costs else 0.0,
        "attributes": _attribute_summary(units, attributes),
        "daily": dict(sorted(daily.items())),
        "top_user_share": (
            Counter(u["user_id"] for u in units if u.get("user_id")).most_common(1)[0][1] / n
            if users
            else 0.0
        ),
    }


def _tests_for(category_id: str, inside: list[dict], outside: list[dict], attributes: list[dict]):
    tests = []
    binaries = dict(BINARY_METRICS)
    for attribute in attributes:
        if attribute["type"] == "boolean":
            key = attribute["key"]
            binaries[f"attr:{key}"] = (
                f"had {key.replace('_', ' ')}",
                lambda u, key=key: bool(u["facets"].get("attributes", {}).get(key)),
            )
    for metric, (label, fn) in binaries.items():
        x1 = sum(1 for u in inside if fn(u))
        x0 = sum(1 for u in outside if fn(u))
        n1, n0 = len(inside), len(outside)
        if n1 < MIN_GROUP or n0 < MIN_GROUP or x1 + x0 == 0:
            continue
        p = fisher_exact([[x1, n1 - x1], [x0, n0 - x0]]).pvalue
        rate1, rate0 = x1 / n1, x0 / n0
        lift = (rate1 + 1e-9) / (rate0 + 1e-9)
        large = (lift >= MIN_LIFT or lift <= 1 / MIN_LIFT) and abs(rate1 - rate0) >= 0.1
        tests.append({
            "category_id": category_id, "metric": metric, "label": label, "kind": "rate",
            "value": rate1, "rest": rate0, "lift": lift, "p": p, "large": large and x1 + x0 >= 3,
        })
    for metric, (label, fn) in NUMERIC_METRICS.items():
        a = [float(v) for v in (fn(u) for u in inside) if v is not None]
        b = [float(v) for v in (fn(u) for u in outside) if v is not None]
        if len(a) < MIN_GROUP or len(b) < MIN_GROUP or len(set(a + b)) < 2:
            continue
        p = mannwhitneyu(a, b, alternative="two-sided").pvalue
        delta = cliffs_delta(a, b)
        tests.append({
            "category_id": category_id, "metric": metric, "label": label, "kind": "median",
            "value": statistics.median(a), "rest": statistics.median(b),
            "lift": (statistics.median(a) + 1e-9) / (statistics.median(b) + 1e-9),
            "p": p, "large": abs(delta) >= MIN_DELTA,
        })
    return tests


def measure(units: list[dict], tops: list[dict], subs: list[dict], attributes: list[dict]) -> dict:
    """Stats for every category plus the report totals.

    ``units`` are analysed (included) units as dicts with facets, metrics,
    category_id and sub_category_id."""
    total = len(units)
    by_top: dict[str, list[dict]] = {}
    by_sub: dict[str, list[dict]] = {}
    for unit in units:
        by_top.setdefault(unit["category_id"], []).append(unit)
        by_sub.setdefault(unit["sub_category_id"], []).append(unit)
    tests = []
    categories = []
    for node, groups in [(t, by_top) for t in tops] + [(s, by_sub) for s in subs]:
        inside = groups.get(node["id"], [])
        inside_keys = {u["key"] for u in inside}
        outside = [u for u in units if u["key"] not in inside_keys]
        stats = describe(inside, attributes)
        low, high = wilson(len(inside), total)
        stats.update({"share": len(inside) / total if total else 0.0, "share_ci": [low, high]})
        categories.append({**node, "stats": stats})
        tests.extend(_tests_for(node["id"], inside, outside, attributes))
    adjusted = benjamini_hochberg([t["p"] for t in tests]) if tests else []
    notable: dict[str, list[dict]] = {}
    for test, q in zip(tests, adjusted, strict=True):
        test["q"] = q
        if q < Q_THRESHOLD and test["large"]:
            notable.setdefault(test["category_id"], []).append(
                {k: v for k, v in test.items() if k not in ("large", "category_id")}
            )
    for category in categories:
        category["notable"] = sorted(
            notable.get(category["id"], []), key=lambda t: t["q"]
        )
    return {"categories": categories, "totals": describe(units, attributes)}
