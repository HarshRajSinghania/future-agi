"""Executive summary for an Insights report.

The thinking model sees only computed statistics and numbered example units,
writes a few findings with citations, and picks highlighted examples. Every
number in a finding is then checked against the statistics; a finding with a
number that isn't there is dropped rather than shown.
"""

from __future__ import annotations

import re

from ee.agenthub.insights.llm import THINKING, Spend, chat_json

MAX_POINTS = 5
MAX_HIGHLIGHTS = 6
EXAMPLES_PER_CATEGORY = 2

UNIT_WORDS = {"traces": "requests", "sessions": "conversations", "users": "users"}

_SYSTEM = (
    "You write the executive summary of a product analytics report about an AI "
    "agent's production traffic. Be concrete and useful to the team that owns the "
    "agent: what is happening, what is going wrong, what to do. Use only numbers "
    "that appear in the statistics, written exactly as given. Cite examples as #n. "
    "Never include personal data. Reply with JSON only."
)


def _pct(value: float) -> str:
    return f"{round(value * 100)}%"


def _notable_text(note: dict) -> str:
    if note["kind"] == "rate":
        return f"{_pct(note['value'])} {note['label']} vs {_pct(note['rest'])} elsewhere"
    if note["metric"] == "latency_ms":
        return f"median latency {note['value'] / 1000:.1f}s vs {note['rest'] / 1000:.1f}s elsewhere"
    return f"{note['label']} {note['value']:.1f} vs {note['rest']:.1f} elsewhere"


def allowed_numbers(result: dict, examples: list[dict]) -> set[str]:
    numbers: set[str] = set()

    def add(value):
        if value is None:
            return
        if isinstance(value, float):
            for text in (f"{value:.1f}", f"{round(value)}", f"{value * 100:.0f}", f"{value * 100:.1f}"):
                numbers.add(text.rstrip("0").rstrip(".") if "." in text else text)
        else:
            numbers.add(str(value))

    totals = result["totals"]
    add(totals["count"])
    add(totals["users"])
    add(totals["sessions"])
    add(result.get("population_size"))
    add(result.get("sample_size"))
    for category in result["categories"]:
        stats = category["stats"]
        for key in ("count", "users", "sessions", "turns"):
            add(stats.get(key))
        add(stats["share"])
        for key in ("failure_rate", "unresolved_rate", "error_rate"):
            add(stats.get(key))
        for count in stats.get("outcomes", {}).values():
            add(count)
        for note in category.get("notable", []):
            add(note["value"])
            add(note["rest"])
            add(note["lift"])
            if note["metric"] == "latency_ms":
                add(note["value"] / 1000)
                add(note["rest"] / 1000)
    for i in range(1, len(examples) + 1):
        numbers.add(str(i))
    return numbers


def verified(text: str, numbers: set[str]) -> bool:
    for found in re.findall(r"\d+(?:\.\d+)?", text):
        normal = found.rstrip("0").rstrip(".") if "." in found else found
        if normal not in numbers and found not in numbers:
            return False
    return True


def pick_examples(units_by_category: dict[str, list[dict]], categories: list[dict]) -> list[dict]:
    """Up to two examples from each category, notable categories first."""
    ordered = sorted(
        (c for c in categories if c["level"] == 2 or not c.get("has_children")),
        key=lambda c: (-len(c.get("notable", [])), -c["stats"]["count"]),
    )
    examples = []
    for category in ordered:
        members = [
            u for u in units_by_category.get(category["id"], []) if u.get("summary")
        ]
        members.sort(key=lambda u: (u["facets"].get("sentiment") or 3))
        for unit in members[:EXAMPLES_PER_CATEGORY]:
            examples.append({"unit": unit, "category": category})
        if len(examples) >= 16:
            break
    return examples


def write_summary(
    *,
    question: str,
    unit: str,
    agent_description: str,
    result: dict,
    units_by_category: dict[str, list[dict]],
    spend: Spend,
) -> dict:
    noun = UNIT_WORDS.get(unit, "items")
    categories = result["categories"]
    tops = [c for c in categories if c["level"] == 1]
    lines = []
    for top in sorted(tops, key=lambda c: -c["stats"]["count"]):
        stats = top["stats"]
        line = (
            f'[{top["id"]}] {top["name"]}: {stats["count"]} {noun} ({_pct(stats["share"])}), '
            f'{stats["users"]} users. {top["description"]}'
        )
        for note in top.get("notable", [])[:3]:
            line += f" Notable: {_notable_text(note)}."
        lines.append(line)
        for sub in sorted(
            (c for c in categories if c.get("parent_id") == top["id"]),
            key=lambda c: -c["stats"]["count"],
        ):
            sstats = sub["stats"]
            sline = (
                f'    [{sub["id"]}] {sub["name"]}: {sstats["count"]} {noun} '
                f'({_pct(sstats["share"])}), {sstats["users"]} users.'
            )
            for note in sub.get("notable", [])[:2]:
                sline += f" Notable: {_notable_text(note)}."
            lines.append(sline)
    examples = pick_examples(units_by_category, categories)
    example_lines = [
        f'#{i} [{e["category"]["name"]}] {e["unit"]["summary"]}'
        for i, e in enumerate(examples, start=1)
    ]
    totals = result["totals"]
    prompt = (
        f"Report question: {question}\nAgent: {agent_description or 'an AI application'}\n"
        f"Analysed {totals['count']} {noun} from {totals['users']} users "
        f"(sampled {result.get('sample_size')} of {result.get('population_size')}).\n\n"
        "Categories (id, name, size, notable differences vs everything else):\n"
        + "\n".join(lines)
        + "\n\nExamples:\n"
        + "\n".join(example_lines)
        + "\n\nReturn {\"title\": \"the report question, phrased crisply\", "
        f"\"key_points\": [up to {MAX_POINTS} findings: {{\"text\": \"one or two sentences "
        "with a number and a recommended action, citing examples as #n\", "
        "\"category_ids\": [\"...\"]}], \"highlights\": [up to "
        f"{MAX_HIGHLIGHTS} {{\"ref\": n, \"reason\": \"why this example matters, one line\"}}]}}. "
        "Lead with the biggest or most actionable finding."
    )
    raw = chat_json(_SYSTEM, prompt, tier=THINKING, max_tokens=1600, temperature=0.3, spend=spend)
    numbers = allowed_numbers(result, examples)
    ids = {c["id"] for c in categories}
    points, dropped = [], 0
    for point in raw.get("key_points", []) if isinstance(raw, dict) else []:
        text = " ".join(str(point.get("text", "")).split()) if isinstance(point, dict) else ""
        if not text:
            continue
        if not verified(text, numbers):
            dropped += 1
            continue
        refs = sorted({int(r) for r in re.findall(r"#(\d+)", text) if 0 < int(r) <= len(examples)})
        points.append({
            "text": text,
            "category_ids": [c for c in point.get("category_ids", []) if c in ids],
            "refs": [{"ref": r, "unit_id": examples[r - 1]["unit"]["unit_id"]} for r in refs],
        })
        if len(points) >= MAX_POINTS:
            break
    highlights = []
    for entry in raw.get("highlights", []) if isinstance(raw, dict) else []:
        try:
            ref = int(entry.get("ref"))
        except (TypeError, ValueError, AttributeError):
            continue
        if not 0 < ref <= len(examples):
            continue
        example = examples[ref - 1]
        highlights.append({
            "ref": ref,
            "unit_id": example["unit"]["unit_id"],
            "category_id": example["category"]["id"],
            "category_name": example["category"]["name"],
            "summary": example["unit"]["summary"],
            "reason": " ".join(str(entry.get("reason", "")).split())[:240],
        })
        if len(highlights) >= MAX_HIGHLIGHTS:
            break
    return {
        "title": " ".join(str(raw.get("title", "")).split())[:200] if isinstance(raw, dict) else "",
        "key_points": points,
        "highlights": highlights,
        "examples": [
            {"ref": i, "unit_id": e["unit"]["unit_id"], "category_id": e["category"]["id"]}
            for i, e in enumerate(examples, start=1)
        ],
        "dropped_points": dropped,
    }
