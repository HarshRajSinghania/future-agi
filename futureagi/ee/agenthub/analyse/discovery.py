"""Analyse Discover: propose categories for a slice of traces.

One generative call reads a sample of traces (drawn by the caller evenly
across the scope's time window) and proposes a single-choice question with a
handful of categories, each with a decision rule and cited examples. A person
edits and approves the categories; Jev then answers the question for every
trace through the ordinary eval-task engine. The proposal never contributes a
count to the report, so the sample shares returned here are only a preview.

Trace text is always read server-side from the caller's project, so this
endpoint cannot be used to send arbitrary text to the model.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field

import structlog

from agentic_eval.core.utils.model_config import ModelConfigs

logger = structlog.get_logger(__name__)

MIN_SAMPLE = 10
MAX_SAMPLE = 150
INPUT_CHARS = 900
OUTPUT_CHARS = 600
MIN_CATEGORIES = 2
MAX_CATEGORIES = 8
LABEL_CHARS = 40
DEFINITION_CHARS = 400
QUOTE_CHARS = 160
MAX_EXAMPLES = 3
MAX_TOKENS = 6000
TIMEOUT_S = 120
OTHER_LABEL = "Other"
OTHER_DEFINITION = "None of the other categories clearly applies to this trace."

_SYSTEM = """You help an AI product team understand their production traffic.
You get a sample of traces from their AI application, drawn evenly across a
time window. Each trace has an id, the user-facing input and the
application's output. The team tells you what they want to understand.

Design ONE single-choice question and between 3 and 7 categories that answer
it. A separate classifier will later read each trace on its own and pick
exactly one category using your definitions, so:
- Categories must be mutually exclusive and decidable from one trace's input
  and output alone.
- Each definition is a decision rule: what must be true to pick it, and what
  belongs elsewhere. One or two sentences, at most 400 characters.
- Labels are 1-4 plain words in Title Case, no punctuation, at most 40
  characters. Never use the label "Other"; it is added automatically.
- Prefer categories the team can act on for their stated goal. Split a large
  vague category rather than keep it; merge categories that rarely differ.
- Every category must fit at least 2 sampled traces.
- For each category cite 2 or 3 sample ids that clearly belong, each with a
  quote of at most 160 characters copied verbatim from that trace's input or
  output.
- Put every sample id in "assignments" with the category it belongs to, or
  "Other" if none fits.

Reply with only this JSON object:
{"question": "...", "categories": [{"label": "...", "definition": "...",
"examples": [{"id": 3, "quote": "..."}]}], "assignments": {"3": "Label"}}"""


class DiscoveryError(Exception):
    """A proposal could not be produced; the message is safe to show users.

    ``unavailable`` marks failures of the model itself (retry later) as
    opposed to problems with the traces or the model's answer."""

    def __init__(self, message: str, *, unavailable: bool = False):
        super().__init__(message)
        self.unavailable = unavailable


@dataclass
class SampledTrace:
    trace_id: str
    input: str
    output: str


@dataclass
class Proposal:
    question: str
    categories: list[dict]
    sample_size: int
    unassigned: int
    model: str
    cost_usd: float = 0.0
    dropped_quotes: int = 0
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "question": self.question,
            "categories": self.categories,
            "sample_size": self.sample_size,
            "unassigned": self.unassigned,
            "model": self.model,
            "cost_usd": self.cost_usd,
            "dropped_quotes": self.dropped_quotes,
        }


def discovery_model() -> str:
    """Turing Flash by default; deployments can point discovery elsewhere."""
    try:
        from django.conf import settings

        configured = getattr(settings, "ANALYSE_DISCOVERY_MODEL", None)
    except Exception:  # pragma: no cover - settings always load in the app
        configured = None
    return (
        configured
        or os.environ.get("ANALYSE_DISCOVERY_MODEL")
        or ModelConfigs.TURING_FLASH.model_name
    )


def _clip(text: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    return text if len(text) <= limit else f"{text[: limit - 1]}…"


def load_sample(project_id: str, trace_ids: list[str]) -> list[SampledTrace]:
    """Root input/output for the requested traces of this project, in the
    caller's order. Traces from other projects simply come back empty."""
    from tracer.services.clickhouse.v2 import get_reader

    with get_reader() as reader:
        roots = reader.roots_by_trace_ids(
            [str(t) for t in trace_ids], project_id=str(project_id)
        )
    latest = {}
    for span in roots:
        # Ordered oldest first per trace; keep the newest root.
        latest[str(span.trace_id)] = span
    sample = []
    for trace_id in trace_ids:
        span = latest.get(str(trace_id))
        if span is None:
            continue
        attrs = span.attrs_string or {}
        text_in = attrs.get("input.value") or span.input or ""
        text_out = attrs.get("output.value") or span.output or ""
        if not (str(text_in).strip() or str(text_out).strip()):
            continue
        sample.append(
            SampledTrace(trace_id=str(trace_id), input=text_in, output=text_out)
        )
    return sample


def build_messages(focus: str, sample: list[SampledTrace]) -> list[dict]:
    lines = []
    for index, trace in enumerate(sample, start=1):
        lines.append(
            f"[{index}] INPUT: {_clip(trace.input, INPUT_CHARS)}\n"
            f"    OUTPUT: {_clip(trace.output, OUTPUT_CHARS)}"
        )
    goal = focus.strip() or "What are these conversations about?"
    return [
        {"role": "system", "content": _SYSTEM},
        {
            "role": "user",
            "content": (
                f"What the team wants to understand: {goal}\n\n"
                f"{len(sample)} sampled traces:\n\n" + "\n\n".join(lines)
            ),
        },
    ]


def _json_object(raw: str) -> dict:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else text
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise DiscoveryError("The model did not return categories. Try again.")
    try:
        data = json.loads(text[start : end + 1])
    except ValueError as exc:
        raise DiscoveryError(
            "The model returned malformed categories. Try again."
        ) from exc
    if not isinstance(data, dict):
        raise DiscoveryError("The model did not return categories. Try again.")
    return data


MIN_QUOTE_CHARS = 8


def _squash(text: str) -> str:
    """Collapse whitespace only; quotes must match the trace's own casing."""
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _verbatim(quote: str, trace: SampledTrace) -> bool:
    core = _squash(quote).rstrip("…").strip()
    if len(core) < MIN_QUOTE_CHARS:
        return False
    return core in _squash(trace.input) or core in _squash(trace.output)


def _items(value) -> list:
    return value if isinstance(value, list) else []


def _clean_label(value) -> str:
    label = re.sub(r"[^\w\s&/'-]", "", str(value or "")).strip()
    label = re.sub(r"\s+", " ", label)
    return label[:LABEL_CHARS].strip()


def parse_proposal(raw: str, sample: list[SampledTrace], model: str) -> Proposal:
    """Validate the model's JSON against the sample. Quotes that are not
    verbatim in the cited trace are dropped rather than shown as evidence."""
    data = _json_object(raw)
    question = _clip(data.get("question") or "", 300)
    if not question:
        raise DiscoveryError("The model did not phrase a question. Try again.")

    by_index = {str(i): trace for i, trace in enumerate(sample, start=1)}
    categories: list[dict] = []
    seen: set[str] = set()
    dropped = 0
    for entry in _items(data.get("categories")):
        if not isinstance(entry, dict):
            continue
        label = _clean_label(entry.get("label"))
        key = label.casefold()
        # "__"-prefixed names are reserved for the result tallies.
        reserved = key == OTHER_LABEL.casefold() or key.startswith("__")
        if not label or reserved or key in seen:
            continue
        definition = _clip(entry.get("definition") or "", DEFINITION_CHARS)
        if not definition:
            continue
        examples = []
        for example in _items(entry.get("examples")):
            if not isinstance(example, dict) or len(examples) >= MAX_EXAMPLES:
                continue
            trace = by_index.get(str(example.get("id")))
            if trace is None:
                dropped += 1
                continue
            quote = _clip(example.get("quote") or "", QUOTE_CHARS)
            if not _verbatim(quote, trace):
                dropped += 1
                continue
            examples.append({"trace_id": trace.trace_id, "quote": quote})
        seen.add(key)
        categories.append(
            {
                "label": label,
                "definition": definition,
                "examples": examples,
                "sample_count": 0,
            }
        )
        if len(categories) >= MAX_CATEGORIES:
            break

    if len(categories) < MIN_CATEGORIES:
        raise DiscoveryError(
            "The model could not find distinct categories in these traces. "
            "Try a wider date range or a more specific goal."
        )

    counts = {category["label"].casefold(): category for category in categories}
    assignments = data.get("assignments")
    if not isinstance(assignments, dict):
        assignments = {}
    unassigned = 0
    for index in by_index:
        label = _clean_label(assignments.get(index, "")).casefold()
        if label in counts:
            counts[label]["sample_count"] += 1
        else:
            unassigned += 1

    return Proposal(
        question=question,
        categories=categories,
        sample_size=len(sample),
        unassigned=unassigned,
        model=model,
        dropped_quotes=dropped,
    )


def _call_model(messages: list[dict], model: str) -> tuple[str, float]:
    from ee.usage.services.gateway_llm_client import (
        call_llm,
        call_llm_raw,
        get_gateway_client,
    )

    client = get_gateway_client()
    if client is None:
        content = call_llm(
            model=model, messages=messages, temperature=0.2, max_tokens=MAX_TOKENS
        )
        return content or "", 0.0
    result = call_llm_raw(
        client,
        model=model,
        messages=messages,
        temperature=0.2,
        max_tokens=MAX_TOKENS,
        timeout=TIMEOUT_S,
    )
    try:
        content = result.response.choices[0].message.content
    except (AttributeError, IndexError):
        content = ""
    return content or "", result.cost_usd


def discover_categories(
    project_id: str, trace_ids: list[str], focus: str = ""
) -> Proposal:
    sample = load_sample(project_id, trace_ids)
    if len(sample) < MIN_SAMPLE:
        raise DiscoveryError(
            f"Only {len(sample)} of these traces have readable input or output. "
            f"Discover needs at least {MIN_SAMPLE}."
        )
    model = discovery_model()
    try:
        raw, cost = _call_model(build_messages(focus, sample), model)
    except DiscoveryError:
        raise
    except Exception as exc:
        logger.warning("analyse_discovery_call_failed", model=model, error=str(exc))
        raise DiscoveryError(
            "The discovery model is unavailable right now. Try again shortly.",
            unavailable=True,
        ) from exc
    if not raw.strip():
        # The no-gateway path reports provider failures as an empty reply.
        raise DiscoveryError(
            "The discovery model is unavailable right now. Try again shortly.",
            unavailable=True,
        )
    proposal = parse_proposal(raw, sample, model)
    proposal.cost_usd = cost
    logger.info(
        "analyse_discovery_proposed",
        project_id=str(project_id),
        model=model,
        sample_size=proposal.sample_size,
        categories=len(proposal.categories),
        dropped_quotes=proposal.dropped_quotes,
        cost_usd=cost,
    )
    return proposal
