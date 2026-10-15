import { describe, expect, it } from "vitest";
import {
  ANSWER_TYPES,
  INSTANT_EVAL_MODEL,
  INSTANT_EVAL_TAG,
  buildEvalMapping,
  buildInstructions,
  buildTemplatePayload,
  cleanCategories,
  evaluatorName,
  validateInstantEval,
} from "../instantEvalPayloads";

const NOW = new Date("2026-10-15T04:30:00Z");

describe("validateInstantEval", () => {
  it("requires a question", () => {
    expect(
      validateInstantEval({ question: "  ", answerType: ANSWER_TYPES.YES_NO }),
    ).toMatch(/Write the question/);
  });

  it("requires two distinct categories for category questions", () => {
    expect(
      validateInstantEval({
        question: "What is this about?",
        answerType: ANSWER_TYPES.CATEGORY,
        categories: ["Billing", " billing "],
      }),
    ).toMatch(/at least two categories/);
    expect(
      validateInstantEval({
        question: "What is this about?",
        answerType: ANSWER_TYPES.CATEGORY,
        categories: ["Billing", "Shipping"],
      }),
    ).toBeNull();
  });

  it("caps categories at ten", () => {
    expect(
      validateInstantEval({
        question: "What is this about?",
        answerType: ANSWER_TYPES.CATEGORY,
        categories: Array.from({ length: 11 }, (_, i) => `c${i}`),
      }),
    ).toMatch(/at most 10/);
  });
});

describe("cleanCategories", () => {
  it("trims, drops blanks and de-duplicates case-insensitively", () => {
    expect(cleanCategories([" Refund", "refund", "", "Shipping "])).toEqual([
      "Refund",
      "Shipping",
    ]);
  });
});

describe("buildTemplatePayload", () => {
  it("builds a Yes/No question as a two-label Jev choice", () => {
    const payload = buildTemplatePayload({
      question: "Is the customer frustrated?",
      answerType: ANSWER_TYPES.YES_NO,
      reads: "input_output",
      now: NOW,
    });
    expect(payload).toMatchObject({
      eval_type: "llm",
      model: INSTANT_EVAL_MODEL,
      output_type: "deterministic",
      choice_scores: { Yes: 1, No: 0 },
      tags: [INSTANT_EVAL_TAG],
      description: "Is the customer frustrated?",
      multi_choice: false,
    });
    expect(payload.jev_mapping).toMatchObject({
      revision: "jev-map-v1",
      question_type: "choice",
      choice: { labels: ["Yes", "No"] },
    });
    expect(payload.instructions).toContain("{{input}}");
    expect(payload.instructions).toContain("{{output}}");
  });

  it("builds a category question with every category as a label", () => {
    const payload = buildTemplatePayload({
      question: "What is the customer asking about?",
      answerType: ANSWER_TYPES.CATEGORY,
      categories: ["Refund", "Shipping", "refund"],
      reads: "input",
      now: NOW,
    });
    expect(payload.choice_scores).toEqual({ Refund: 1, Shipping: 1 });
    expect(payload.jev_mapping.choice.labels).toEqual(["Refund", "Shipping"]);
    expect(payload.instructions).toContain("{{input}}");
    expect(payload.instructions).not.toContain("{{output}}");
  });
});

describe("helpers", () => {
  it("maps template variables to the root span fields Jev reads", () => {
    expect(buildEvalMapping("input_output")).toEqual({
      input: "input",
      output: "output",
    });
    expect(buildEvalMapping("output")).toEqual({ output: "output" });
  });

  it("puts the question first and labels each variable", () => {
    expect(buildInstructions("Is it urgent?", "output")).toBe(
      "Is it urgent?\n\nTrace output:\n{{output}}",
    );
  });

  it("names evaluators with a slug the template API accepts", () => {
    expect(
      evaluatorName("Did the agent promise a refund, without checking?", NOW),
    ).toBe("did-the-agent-promise-a-refund-without-checking-1015043000");
  });
});
