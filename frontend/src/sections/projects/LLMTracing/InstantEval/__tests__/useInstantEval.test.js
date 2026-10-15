import { describe, expect, it, vi } from "vitest";

vi.mock("src/utils/axios", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  readQuery: vi.fn(),
  endpoints: { project: {}, develop: { eval: {} } },
}));

import {
  answerFromCell,
  buildAnswerFilter,
  itemFromConfig,
  splitScopeFilters,
  summarizeRows,
} from "../useInstantEval";

const RANGE = ["2026-10-08T00:00:00Z", "2026-10-15T23:00:00Z"];
const DATE_ITEM = {
  column_id: "created_at",
  filter_config: {
    filter_type: "datetime",
    filter_op: "between",
    filter_value: RANGE,
  },
};
const STATUS_ITEM = {
  column_id: "status",
  filter_config: {
    filter_type: "text",
    filter_op: "equals",
    filter_value: "OK",
  },
};

describe("splitScopeFilters", () => {
  it("moves the grid's created_at window into date_range", () => {
    expect(splitScopeFilters([STATUS_ITEM, DATE_ITEM])).toEqual({
      dateRange: RANGE,
      filters: [STATUS_ITEM],
    });
  });

  it("leaves non-between created_at filters in place", () => {
    const after = {
      column_id: "created_at",
      filter_config: {
        filter_type: "datetime",
        filter_op: "greater_than",
        filter_value: RANGE[0],
      },
    };
    expect(splitScopeFilters([after])).toEqual({
      dateRange: undefined,
      filters: [after],
    });
  });
});

describe("answerFromCell", () => {
  it("reads the label whose count is positive", () => {
    expect(answerFromCell({ Yes: 0, No: 1 })).toBe("No");
  });
  it("reports errors and missing answers", () => {
    expect(answerFromCell({ error: true })).toBe("error");
    expect(answerFromCell({ status: "running" })).toBeUndefined();
    expect(answerFromCell(undefined)).toBeUndefined();
  });
});

describe("summarizeRows", () => {
  const items = [
    { configId: "q1", labels: ["Yes", "No"] },
    { configId: "q2", labels: ["Refund", "Shipping"] },
  ];
  const rows = [
    {
      trace_id: "t2",
      start_time: "2026-10-14T10:00:00Z",
      input: "b",
      q1: { Yes: 1, No: 0 },
      q2: { Refund: 1, Shipping: 0 },
    },
    {
      trace_id: "t1",
      start_time: "2026-10-13T10:00:00Z",
      input: "a",
      q1: { Yes: 0, No: 1 },
      q2: { error: true },
    },
    {
      trace_id: "t3",
      start_time: "2026-10-15T10:00:00Z",
      input: "c",
      q1: { status: "running" },
    },
  ];

  it("orders traces oldest to newest with each question's answer", () => {
    const { traces } = summarizeRows(rows, items);
    expect(traces.map((t) => t.traceId)).toEqual(["t1", "t2", "t3"]);
    expect(traces[0].answers).toEqual({ q1: "No", q2: "error" });
    expect(traces[2].answers).toEqual({ q1: undefined, q2: undefined });
  });

  it("counts answers per question and keeps errors separate", () => {
    const { counts } = summarizeRows(rows, items);
    expect(counts.q1).toEqual({ Yes: 1, No: 1, __errors: 0 });
    expect(counts.q2).toEqual({ Refund: 1, Shipping: 0, __errors: 1 });
  });
});

describe("filters and saved questions", () => {
  it("builds the EVAL_METRIC filter the trace grid understands", () => {
    expect(
      buildAnswerFilter({ configId: "c1", question: "Refund promised?" }, [
        "Yes",
      ]),
    ).toEqual({
      column_id: "c1",
      property_id: "eval_config:c1",
      display_name: "Refund promised?",
      filter_config: {
        filter_type: "text",
        filter_op: "in",
        filter_value: ["Yes"],
        col_type: "EVAL_METRIC",
      },
    });
  });

  it("only treats configs created by Instant eval as saved questions", () => {
    expect(itemFromConfig({ id: "c1", config: {} })).toBeNull();
    expect(
      itemFromConfig({
        id: "c2",
        name: "Refund promised?",
        eval_template: "t2",
        config: {
          instant_eval: {
            question: "Refund promised?",
            answer_type: "yes_no",
            labels: ["Yes", "No"],
            reads: "input_output",
          },
        },
      }),
    ).toEqual({
      configId: "c2",
      name: "Refund promised?",
      templateId: "t2",
      question: "Refund promised?",
      answerType: "yes_no",
      labels: ["Yes", "No"],
      reads: "input_output",
    });
  });
});
