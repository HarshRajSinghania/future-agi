import { describe, expect, it, vi } from "vitest";

vi.mock("src/utils/axios", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  readQuery: vi.fn(),
  endpoints: { project: {}, develop: { eval: {} } },
}));

import {
  draftsFromQuestions,
  endUserIds,
  handedOverScope,
  limitHelp,
  limitOptionLabel,
  normalizeReads,
  populationCount,
  progressCounts,
  runCoverage,
  runStatusText,
  scopeLabel,
  scopeLine,
  sessionIdsFromUserSessions,
  sessionsTaskPayload,
  splitScopeFilters,
  traceIdsFilter,
  tracesTaskPayload,
  userSessionsRequest,
} from "../instantEvalUnits";

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
const ITEMS = [
  { configId: "c1", question: "Did the customer get what they came for?" },
  { configId: "c2", question: "Was the customer upset?" },
];
const U1 = "5fd6ed2b-9f0c-577b-99fd-63f543ca3f20";
const U2 = "d6126f89-131e-59fd-a9ac-9a1448c03c0c";

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

describe("task payloads", () => {
  it("runs a trace question over the view's filters and window", () => {
    expect(
      tracesTaskPayload({
        projectId: "p1",
        items: ITEMS,
        limit: 200,
        scopeFilters: [STATUS_ITEM, DATE_ITEM],
      }),
    ).toEqual({
      name: "Instant eval · Did the customer get what they came for?",
      project: "p1",
      evals: ["c1", "c2"],
      filters: { date_range: RANGE, filters: [STATUS_ITEM] },
      run_type: "historical",
      row_type: "traces",
      spans_limit: 200,
      sampling_rate: 100,
    });
  });

  it("runs a session question over exactly the sessions in view", () => {
    expect(
      sessionsTaskPayload({
        projectId: "p1",
        items: ITEMS,
        sessionIds: ["s1", "s2", "s3"],
      }),
    ).toEqual({
      name: "Instant eval · Did the customer get what they came for?",
      project: "p1",
      evals: ["c1", "c2"],
      filters: { session_id: ["s1", "s2", "s3"] },
      run_type: "historical",
      row_type: "sessions",
      spans_limit: 3,
      sampling_rate: 100,
    });
  });

  it("turns handed-over traces into one membership filter", () => {
    expect(traceIdsFilter(["t1", "t2"])).toEqual({
      column_id: "trace_id",
      filter_config: {
        filter_type: "text",
        filter_op: "in",
        filter_value: ["t1", "t2"],
      },
    });
  });
});

describe("the users flow", () => {
  it("keeps only end-user ids the lookup accepts, once each", () => {
    expect(
      endUserIds([{ id: U1 }, { id: "cust_kai" }, U2, { id: U1 }, null]),
    ).toEqual([U1, U2]);
  });

  it("asks for each user's latest five sessions in the view's window", () => {
    expect(
      userSessionsRequest({
        projectId: "p1",
        userIds: [U1, U2],
        filters: [STATUS_ITEM, DATE_ITEM],
      }),
    ).toEqual({
      project_id: "p1",
      end_user_ids: [U1, U2],
      per_user: 5,
      window: RANGE,
    });
    expect(
      userSessionsRequest({ projectId: "p1", userIds: [U1], filters: [] }),
    ).not.toHaveProperty("window");
  });

  it("collects the users' session ids in order, once each", () => {
    expect(
      sessionIdsFromUserSessions({
        sessions: [
          { session_id: "s2", end_user_id: U1 },
          { session_id: "s1", end_user_id: U1 },
          { session_id: "s2", end_user_id: U2 },
          { end_user_id: U2 },
        ],
        users: 2,
      }),
    ).toEqual(["s2", "s1"]);
    expect(sessionIdsFromUserSessions(undefined)).toEqual([]);
  });

  it("says that each user is read through their latest sessions", () => {
    expect(limitOptionLabel("users", 25)).toBe("Up to 25 users × 5 sessions");
    expect(limitHelp({ unit: "users", limit: 25 })).toMatch(
      /latest 5 sessions .*up to 125 sessions/,
    );
    expect(limitOptionLabel("sessions", 50)).toBe("Up to 50 sessions");
  });
});

describe("reads", () => {
  it("reads whole conversations for sessions and users", () => {
    expect(normalizeReads("sessions", "input_output")).toBe("transcript");
    expect(normalizeReads("users", undefined)).toBe("transcript");
    expect(normalizeReads("traces", "output")).toBe("output");
    expect(normalizeReads("traces", "transcript")).toBe("input_output");
  });
});

describe("scope", () => {
  it("labels the scope with its date label and other filters", () => {
    expect(
      scopeLabel({ label: "Past 7D", filters: [DATE_ITEM, STATUS_ITEM] }),
    ).toBe("Past 7D · 1 filter");
    expect(scopeLabel({ label: "Past 7D", filters: [DATE_ITEM] })).toBe(
      "Past 7D",
    );
  });

  it("only proves an exact count when the list does", () => {
    expect(populationCount({ items: [{}, {}], total: 2, limit: 200 })).toEqual({
      count: 2,
      lowerBound: false,
    });
    // Filled the read and the list gave no larger total: at least that many.
    expect(
      populationCount({
        items: new Array(200).fill({}),
        total: 200,
        limit: 200,
      }),
    ).toEqual({ count: 200, lowerBound: true });
    expect(
      populationCount({
        items: new Array(200).fill({}),
        total: 1234,
        limit: 200,
      }),
    ).toEqual({ count: 1234, lowerBound: false });
  });

  it("describes the rows in view or the handed-over rows", () => {
    expect(
      scopeLine({
        unit: "sessions",
        population: { items: new Array(12).fill({}), total: 12, limit: 200 },
        label: "Past 7D · 1 filter",
      }),
    ).toBe("12 sessions in this view · Past 7D · 1 filter");
    expect(
      scopeLine({
        unit: "traces",
        population: { items: new Array(500).fill({}), total: 500, limit: 500 },
        label: "Past 7D",
      }),
    ).toBe("500+ traces in this view · Past 7D");
    expect(
      scopeLine({
        unit: "sessions",
        handedOver: { ids: ["a", "b"], label: "“No” answers" },
      }),
    ).toBe("2 sessions from “No” answers");
  });

  it("caps a run at what is in view when the count is exact", () => {
    const population = { items: new Array(12).fill({}), total: 12, limit: 200 };
    expect(runCoverage({ limit: 50, population })).toBe(12);
    expect(
      runCoverage({
        limit: 50,
        population: { items: new Array(200).fill({}), total: 200, limit: 200 },
      }),
    ).toBe(50);
    expect(runCoverage({ limit: 50, handedOver: { ids: ["a", "b"] } })).toBe(2);
  });

  it("only applies a hand-off's rows to the view it was meant for", () => {
    expect(
      handedOverScope({ unit: "sessions", ids: ["a", "a", "b"] }, "sessions"),
    ).toEqual({ ids: ["a", "b"], label: "" });
    expect(handedOverScope({ unit: "users", ids: ["a"] }, "sessions")).toBe(
      null,
    );
    expect(handedOverScope({ unit: "sessions" }, "sessions")).toBe(null);
  });
});

describe("drafts", () => {
  it("turns handed-over questions into editor drafts", () => {
    const drafts = draftsFromQuestions([
      { question: "Did they get it?", answerType: "yes_no" },
      {
        question: "How did it end?",
        answerType: "category",
        categories: ["Resolved", " resolved", "Abandoned"],
        definitions: { Resolved: "The customer said thanks" },
      },
    ]);
    expect(drafts).toEqual([
      {
        question: "Did they get it?",
        answerType: "yes_no",
        categories: [],
        definitions: {},
      },
      {
        question: "How did it end?",
        answerType: "category",
        categories: ["Resolved", "Abandoned"],
        definitions: { Resolved: "The customer said thanks" },
      },
    ]);
    expect(draftsFromQuestions(undefined)).toHaveLength(1);
    expect(
      draftsFromQuestions(
        Array.from({ length: 7 }, (_, i) => ({ question: `q${i}` })),
      ),
    ).toHaveLength(5);
  });
});

describe("progress", () => {
  it("shares the task's counts across questions", () => {
    expect(
      progressCounts(
        {
          status: "running",
          total_count: 20,
          success_count: 12,
          errors_count: 2,
          skipped_count: 2,
          error_groups: [{ count: 2 }],
        },
        2,
      ),
    ).toEqual({
      status: "running",
      total: 10,
      completed: 6,
      failed: 2,
      expected: 7,
      errorGroups: [{ count: 2 }],
    });
  });

  it("says where a run is", () => {
    expect(runStatusText({ phase: "collecting" }, "users")).toMatch(
      /users in this view and their latest sessions/,
    );
    expect(
      runStatusText(
        { phase: "running", progress: { total: 60, completed: 10, failed: 2 } },
        "users",
      ),
    ).toBe("Jev is reading sessions · 12 of 60");
    expect(
      runStatusText(
        {
          phase: "done",
          progress: { total: 50 },
          startedAt: "2026-10-15T10:00:00Z",
          finishedAt: "2026-10-15T10:00:14Z",
        },
        "sessions",
        48,
      ),
    ).toBe("48 of 50 sessions answered in 14s");
    expect(
      runStatusText(
        { phase: "done", asked: { users: 5, sessions: 6 } },
        "users",
        5,
      ),
    ).toBe("5 users answered from 6 sessions");
  });
});
