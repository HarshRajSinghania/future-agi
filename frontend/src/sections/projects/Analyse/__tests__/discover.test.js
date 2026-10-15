import { describe, expect, it, vi } from "vitest";

vi.mock("src/utils/axios", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  readQuery: vi.fn(),
  endpoints: { project: {}, develop: { eval: {} } },
}));

import {
  OTHER_LABEL,
  proposalToQuestion,
  sampleEvenly,
  validateProposal,
} from "../DiscoverComposer";
import {
  adjustPValues,
  computeAnswerStats,
  proportionTest,
  rankTest,
} from "../answerStats";
import { buildTemplatePayload } from "src/sections/projects/LLMTracing/InstantEval/instantEvalPayloads";

describe("sampleEvenly", () => {
  const traces = Array.from({ length: 10 }, (_, i) => ({
    traceId: `t${i}`,
    time: new Date(2026, 9, 1, i).toISOString(),
  }));

  it("spans the whole window, oldest to newest", () => {
    expect(sampleEvenly([...traces].reverse(), 4)).toEqual([
      "t0",
      "t3",
      "t6",
      "t9",
    ]);
  });

  it("takes everything when the scope is smaller than the sample", () => {
    expect(sampleEvenly(traces, 50)).toHaveLength(10);
  });
});

describe("proposal review", () => {
  const categories = [
    { label: "Refunds", definition: "Wants money back." },
    { label: "Tracking", definition: "Asks where an order is." },
  ];

  it("accepts a clean proposal and rejects broken ones", () => {
    expect(validateProposal({ question: "Why?", categories })).toBeNull();
    expect(validateProposal({ question: " ", categories })).toMatch(/question/);
    expect(
      validateProposal({
        question: "Why?",
        categories: [...categories, { label: "refunds", definition: "" }],
      }),
    ).toMatch(/differ/);
    expect(
      validateProposal({
        question: "Why?",
        categories: [{ label: "Other", definition: "" }, categories[0]],
      }),
    ).toMatch(/Other/);
  });

  it("turns the approved categories into a Jev question with Other", () => {
    const question = proposalToQuestion({ question: " Why? ", categories });
    expect(question.question).toBe("Why?");
    expect(question.categories).toEqual(["Refunds", "Tracking", OTHER_LABEL]);
    expect(question.definitions.Refunds).toBe("Wants money back.");
    expect(question.definitions[OTHER_LABEL]).toBeTruthy();
  });

  it("sends each definition to Jev as the label's criterion", () => {
    const payload = buildTemplatePayload({
      ...proposalToQuestion({ question: "Why?", categories }),
      reads: "input_output",
      now: new Date("2026-10-14T00:00:00Z"),
    });
    expect(payload.jev_mapping.choice.labels).toEqual([
      "Refunds",
      "Tracking",
      OTHER_LABEL,
    ]);
    expect(payload.jev_mapping.choice.descriptions.Tracking).toBe(
      "Asks where an order is.",
    );
  });
});

describe("answer statistics", () => {
  it("finds no difference between identical groups", () => {
    expect(rankTest([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])).toBeGreaterThan(0.9);
    expect(proportionTest(1, 10, 1, 10)).toBeGreaterThan(0.9);
  });

  it("detects clearly separated groups", () => {
    const slow = Array.from({ length: 20 }, (_, i) => 3000 + i);
    const fast = Array.from({ length: 20 }, (_, i) => 1000 + i);
    expect(rankTest(slow, fast)).toBeLessThan(0.001);
    expect(proportionTest(15, 20, 1, 20)).toBeLessThan(0.001);
  });

  it("adjusts p-values with Benjamini-Hochberg", () => {
    expect(adjustPValues([0.01, 0.04, 0.03])).toEqual([0.03, 0.04, 0.04]);
  });

  it("flags a slower answer only when the gap is real", () => {
    const item = { configId: "q", labels: ["Slow", "Fast"] };
    const traces = [
      ...Array.from({ length: 20 }, (_, i) => ({
        latency: 4000 + i,
        status: "OK",
        answers: { q: "Slow" },
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        latency: 1000 + i,
        status: i < 2 ? "ERROR" : "OK",
        answers: { q: "Fast" },
      })),
      { latency: 50, status: "OK", answers: { q: "error" } },
    ];
    const stats = computeAnswerStats(traces, item);
    expect(stats.answered).toBe(40);
    const slow = stats.rows.find((row) => row.label === "Slow");
    expect(slow.latencyNotable).toBe(true);
    expect(slow.latencyRatio).toBeGreaterThan(3);
    // 0 of 20 vs 2 of 20 errors is not enough evidence.
    expect(slow.errorNotable).toBe(false);
  });
});
