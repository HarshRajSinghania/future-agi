import { describe, expect, it, vi } from "vitest";

vi.mock("src/utils/axios", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  readQuery: vi.fn(),
  endpoints: { project: {}, develop: { eval: {} } },
}));

import sessionsResponse from "./fixtures/answers-sessions.json";
import usersResponse from "./fixtures/answers-users.json";
import {
  ERROR_ANSWER,
  SKIPPED_ANSWER,
  analyseSeedFromAnswers,
  answeredCount,
  filterRows,
  isUnsure,
  labelCountsText,
  normalizeAnswers,
  summarizeQuestion,
  traceMetrics,
  traceRecords,
} from "../instantEvalAnswers";

// Real answers-endpoint responses: six sessions, and the same task rolled up
// into five users.
const CONFIG = "22a44112-0680-4a5b-a549-1427ee33c253";
const ITEM = {
  configId: CONFIG,
  question: "Did the customer get what they came for?",
  answerType: "yes_no",
  labels: ["Yes", "No"],
};
const sessions = normalizeAnswers(sessionsResponse.result);
const users = normalizeAnswers(usersResponse.result);

describe("normalizeAnswers", () => {
  it("reads each session's answer, confidence and display fields", () => {
    expect(sessions.rows).toHaveLength(6);
    expect(sessions.rows[1]).toMatchObject({
      id: "e4cfaff7-55c4-52cd-b000-9e8158d4f7b1",
      userId: "cust_ines_979",
      endUserId: "d6126f89-131e-59fd-a9ac-9a1448c03c0c",
      sessions: null,
      answers: { [CONFIG]: { answer: "No", confidence: 0.2, counts: null } },
    });
    expect(sessions.rows[1].excerpt).toMatch(/Pine Trail Boots/);
  });

  it("reads each user's session count and per-label counts", () => {
    expect(users.rows[0]).toMatchObject({
      id: "5fd6ed2b-9f0c-577b-99fd-63f543ca3f20",
      label: "cust_kai_278",
      sessions: 2,
      answers: {
        [CONFIG]: { answer: "Yes", confidence: null, counts: { Yes: 2 } },
      },
    });
  });

  it("drops rows without an id and answers without a label", () => {
    const { rows } = normalizeAnswers({
      rows: [
        { id: "", answers: {} },
        { id: "s1", answers: { c1: { answer: null }, c2: { answer: "No" } } },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].answers)).toEqual(["c2"]);
  });
});

describe("summarizeQuestion", () => {
  it("counts each label with its share and how often Jev was unsure", () => {
    const summary = summarizeQuestion(sessions.rows, ITEM);
    expect(summary.total).toBe(6);
    expect(summary.labels).toEqual([
      { label: "Yes", count: 4, share: 4 / 6 },
      { label: "No", count: 2, share: 2 / 6 },
    ]);
    // Confidences 0.5, 0.2, 0.52 and 0.36 are under 0.6.
    expect(summary.unsure).toBe(4);
    expect(summary.errors.count).toBe(0);
  });

  it("counts a user once, under their most common answer", () => {
    const summary = summarizeQuestion(users.rows, ITEM);
    expect(summary.total).toBe(5);
    expect(summary.labels.map((entry) => entry.count)).toEqual([3, 2]);
    expect(summary.unsure).toBe(0);
  });

  it("keeps failures and skips apart from the labels", () => {
    const rows = [
      { id: "a", answers: { q: { answer: "Refund" } } },
      { id: "b", answers: { q: { answer: ERROR_ANSWER } } },
      { id: "c", answers: { q: { answer: SKIPPED_ANSWER } } },
      { id: "d", answers: { q: { answer: "Gone" } } },
      { id: "e", answers: {} },
    ];
    const summary = summarizeQuestion(rows, {
      configId: "q",
      labels: ["Refund", "Shipping"],
    });
    expect(summary.total).toBe(4);
    expect(summary.labels.map((entry) => [entry.label, entry.count])).toEqual([
      ["Refund", 1],
      ["Shipping", 0],
      ["Gone", 1],
    ]);
    expect(summary.errors).toEqual({ count: 1, share: 0.25 });
    expect(summary.skipped).toEqual({ count: 1, share: 0.25 });
  });
});

describe("filters", () => {
  it("flags answers under 60% confidence, never failures", () => {
    expect(isUnsure({ answer: "No", confidence: 0.59 })).toBe(true);
    expect(isUnsure({ answer: "No", confidence: 0.6 })).toBe(false);
    expect(isUnsure({ answer: "No", confidence: null })).toBe(false);
    expect(isUnsure({ answer: ERROR_ANSWER, confidence: 0.1 })).toBe(false);
  });

  it("filters rows by answer, by unsure answers and by id", () => {
    const no = filterRows(sessions.rows, { configId: CONFIG, answer: "No" });
    expect(no.map((row) => row.userId)).toEqual([
      "cust_ines_979",
      "cust_priya_597",
    ]);
    const unsureYes = filterRows(sessions.rows, {
      configId: CONFIG,
      answer: "Yes",
      unsureOnly: true,
    });
    expect(unsureYes).toHaveLength(2);
    const picked = filterRows(sessions.rows, {
      configId: CONFIG,
      ids: new Set([sessions.rows[0].id]),
    });
    expect(picked).toEqual([sessions.rows[0]]);
  });

  it("writes a user's label counts most common first", () => {
    expect(labelCountsText({ No: 1, Yes: 2, [ERROR_ANSWER]: 1 })).toBe(
      "Yes 2 · No 1 · Failed 1",
    );
  });
});

describe("answeredCount", () => {
  it("counts rows, or sessions for users", () => {
    expect(answeredCount(sessions, [ITEM], "sessions")).toBe(6);
    expect(answeredCount(users, [ITEM], "users")).toBe(6);
    expect(
      answeredCount(sessions, [ITEM, { configId: "other" }], "sessions"),
    ).toBe(0);
  });
});

describe("analyseSeedFromAnswers", () => {
  it("hands the sessions that got one answer to Analyse", () => {
    expect(
      analyseSeedFromAnswers({
        unit: "sessions",
        item: ITEM,
        answer: "No",
        rows: sessions.rows,
      }),
    ).toEqual({
      unit: "sessions",
      population: [
        {
          id: "e4cfaff7-55c4-52cd-b000-9e8158d4f7b1",
          time: "2026-10-15T08:42:33.644514+00:00",
          user_id: "cust_ines_979",
        },
        {
          id: "449c2494-769c-55de-b8c7-7e79c70372d3",
          time: "2026-10-15T08:42:33.644514+00:00",
          user_id: "cust_priya_597",
        },
      ],
      question:
        "Why did these sessions get “No” for “Did the customer get what they came for?”?",
      label: "“No” answers · Did the customer get what they came for?",
      source: "Instant eval: Did the customer get what they came for?",
    });
  });

  it("hands users over by end-user id", () => {
    const seed = analyseSeedFromAnswers({
      unit: "users",
      item: ITEM,
      answer: "No",
      rows: users.rows.slice(0, 2),
    });
    expect(seed.population).toEqual([
      {
        id: "d6126f89-131e-59fd-a9ac-9a1448c03c0c",
        time: "2026-10-15T08:42:33.644514+00:00",
        user_id: "cust_ines_979",
      },
    ]);
    expect(seed.question).toMatch(/^Why did this user get “No”/);
  });
});

describe("trace records", () => {
  it("joins answers with the grid's latency, cost and status", () => {
    const metrics = traceMetrics([
      { trace_id: "t1", latency: "1200", cost: "", status: "ERROR" },
      { trace_id: "t2", latency: 300, cost: 0.002, status: "OK" },
    ]);
    const records = traceRecords(
      [
        {
          id: "t2",
          time: "2026-10-15T10:00:00Z",
          excerpt: "b",
          answers: { q: { answer: SKIPPED_ANSWER } },
        },
        {
          id: "t1",
          time: "2026-10-14T10:00:00Z",
          excerpt: "a",
          answers: { q: { answer: "Yes" } },
        },
        { id: "t3", time: "", answers: {} },
      ],
      [{ configId: "q" }],
      metrics,
    );
    expect(records).toEqual([
      {
        traceId: "t1",
        time: "2026-10-14T10:00:00Z",
        input: "a",
        status: "ERROR",
        latency: 1200,
        cost: null,
        tokens: null,
        answers: { q: "Yes" },
      },
      {
        traceId: "t2",
        time: "2026-10-15T10:00:00Z",
        input: "b",
        status: "OK",
        latency: 300,
        cost: 0.002,
        tokens: null,
        // A skipped trace counts as unanswered in the heatmap.
        answers: { q: undefined },
      },
    ]);
  });
});
