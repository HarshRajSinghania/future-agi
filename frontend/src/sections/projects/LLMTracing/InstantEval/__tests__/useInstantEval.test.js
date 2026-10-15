import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), read: vi.fn() }));
const population = vi.hoisted(() => ({ collect: vi.fn() }));

vi.mock("src/utils/axios", () => ({
  default: { get: http.get, post: http.post },
  readQuery: http.read,
  endpoints: {
    project: {
      getEvalTaskConfig: () => "/configs",
      createEvalTaskConfig: () => "/config",
      createEvalTask: () => "/task",
      getEvalTaskLogs: () => "/logs",
      getEvalTaskList: () => "/tasks",
      instantEvalAnswers: () => "/answers",
      instantEvalUserSessions: () => "/user-sessions",
      getTracesForObserveProject: () => "/traces",
    },
    develop: { eval: { createEvalTemplateV2: "/template" } },
  },
}));
vi.mock("src/sections/projects/observePopulation", async (importOriginal) => ({
  ...(await importOriginal()),
  collectPopulation: population.collect,
}));

import {
  AI_PROVIDERS_SETTINGS_PATH,
  buildAnswerFilter,
  explainErrorGroups,
  itemFromConfig,
  matchesSavedQuestion,
  useInstantEvalRun,
} from "../useInstantEval";

const ok = (result) => ({ data: { status: true, result } });
const RANGE = ["2026-10-08T00:00:00.000Z", "2026-10-15T23:00:00.000Z"];
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
const U1 = "5fd6ed2b-9f0c-577b-99fd-63f543ca3f20";
const U2 = "d6126f89-131e-59fd-a9ac-9a1448c03c0c";
const QUESTION = {
  question: "Did the customer get what they came for?",
  answerType: "yes_no",
  categories: [],
};

// A backend that saves one evaluator ("c1") and finishes the task at once.
function serve({ answers, progress, userSessions }) {
  http.get.mockImplementation((url) => {
    if (url === "/configs") return Promise.resolve(ok([]));
    if (url === "/logs") return Promise.resolve(ok(progress));
    if (url === "/answers") return Promise.resolve(ok(answers));
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  http.post.mockImplementation((url) => {
    if (url === "/template") return Promise.resolve(ok({ id: "t1" }));
    if (url === "/config") return Promise.resolve(ok({ id: "c1" }));
    if (url === "/task") return Promise.resolve(ok({ id: "task-1" }));
    if (url === "/user-sessions") return Promise.resolve(ok(userSessions));
    return Promise.reject(new Error(`unexpected POST ${url}`));
  });
}

const postBody = (url) =>
  http.post.mock.calls.find(([called]) => called === url)?.[1];

const answer = (value, confidence) => ({
  c1: { answer: value, explanation: "", confidence },
});

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.sessionStorage?.clear();
});

describe("useInstantEvalRun on the Sessions view", () => {
  it("asks about the exact sessions in view through a sessions task", async () => {
    population.collect.mockResolvedValue({
      items: [{ id: "s1" }, { id: "s2" }],
      total: 2,
    });
    serve({
      progress: { status: "completed", total_count: 2, success_count: 2 },
      answers: {
        unit: "sessions",
        rows: [
          { id: "s1", label: "a", time: RANGE[0], answers: answer("Yes", 0.9) },
          { id: "s2", label: "b", time: RANGE[0], answers: answer("No", 0.3) },
        ],
        answered: 2,
      },
    });
    const { result } = renderHook(() => useInstantEvalRun("p1", "sessions"));
    await act(async () => {
      result.current.start({
        questions: [QUESTION],
        reads: "input_output",
        limit: 50,
        scope: { filters: [STATUS_ITEM, DATE_ITEM], label: "Past 7D" },
      });
    });
    await waitFor(() => expect(result.current.run.phase).toBe("done"));

    expect(population.collect).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: "sessions",
        projectId: "p1",
        filters: [STATUS_ITEM, DATE_ITEM],
        limit: 50,
      }),
    );
    // Sessions always read the whole conversation, whatever was asked for.
    expect(postBody("/template").instructions).toContain("{{transcript}}");
    expect(postBody("/config").mapping).toEqual({ transcript: "transcript" });
    expect(postBody("/config").config.instant_eval).toMatchObject({
      unit: "sessions",
      reads: "transcript",
    });
    expect(postBody("/task")).toMatchObject({
      evals: ["c1"],
      filters: { session_id: ["s1", "s2"] },
      row_type: "sessions",
      run_type: "historical",
      spans_limit: 2,
      sampling_rate: 100,
    });
    expect(http.get).toHaveBeenCalledWith("/answers", {
      params: {
        project_id: "p1",
        eval_task_id: "task-1",
        unit: "sessions",
        config_ids: "c1",
      },
    });
    expect(result.current.run.answers.rows.map((row) => row.id)).toEqual([
      "s1",
      "s2",
    ]);
    expect(result.current.run.asked).toEqual({ sessions: 2 });
  });

  it("finishes without a task when no sessions are in view", async () => {
    population.collect.mockResolvedValue({ items: [], total: 0 });
    serve({});
    const { result } = renderHook(() => useInstantEvalRun("p1", "sessions"));
    await act(async () => {
      result.current.start({
        questions: [QUESTION],
        limit: 50,
        scope: { filters: [DATE_ITEM] },
      });
    });
    await waitFor(() => expect(result.current.run.phase).toBe("done"));
    expect(result.current.run.empty).toMatch(/no sessions in this view/);
    expect(http.post).not.toHaveBeenCalled();
  });

  it("reopens the last finished run from session storage", async () => {
    population.collect.mockResolvedValue({ items: [{ id: "s1" }], total: 1 });
    serve({
      progress: { status: "completed", total_count: 1, success_count: 1 },
      answers: {
        rows: [{ id: "s1", answers: answer("Yes", 0.9), time: RANGE[0] }],
      },
    });
    const first = renderHook(() => useInstantEvalRun("p1", "sessions"));
    await act(async () => {
      first.result.current.start({
        questions: [QUESTION],
        limit: 25,
        scope: { filters: [DATE_ITEM] },
      });
    });
    await waitFor(() => expect(first.result.current.run.phase).toBe("done"));
    first.unmount();

    http.get.mockClear();
    const again = renderHook(() => useInstantEvalRun("p1", "sessions"));
    expect(again.result.current.run).toMatchObject({
      phase: "done",
      taskId: "task-1",
    });
    await waitFor(() =>
      expect(again.result.current.run.answers.rows).toHaveLength(1),
    );
    // One answers read, no progress polling for a finished run.
    expect(http.get.mock.calls.map(([url]) => url)).toEqual(["/answers"]);
    // Another unit of the same project starts clean.
    const users = renderHook(() => useInstantEvalRun("p1", "users"));
    expect(users.result.current.run.phase).toBe("idle");
  });
});

describe("useInstantEvalRun on the Users view", () => {
  it("answers each user's latest sessions and reads the answers per user", async () => {
    population.collect.mockResolvedValue({
      items: [{ id: U1 }, { id: U2 }, { id: "not-a-uuid" }],
      total: 3,
    });
    serve({
      userSessions: {
        sessions: [
          { session_id: "s1", end_user_id: U1 },
          { session_id: "s2", end_user_id: U1 },
          { session_id: "s3", end_user_id: U2 },
        ],
        users: 2,
      },
      progress: { status: "completed", total_count: 3, success_count: 3 },
      answers: {
        unit: "users",
        rows: [
          {
            id: U1,
            label: "cust_kai",
            sessions: 2,
            answers: { c1: { answer: "Yes", counts: { Yes: 2 } } },
          },
          {
            id: U2,
            label: "cust_ines",
            sessions: 1,
            answers: { c1: { answer: "No", counts: { No: 1 } } },
          },
        ],
      },
    });
    const { result } = renderHook(() => useInstantEvalRun("p1", "users"));
    await act(async () => {
      result.current.start({
        questions: [QUESTION],
        limit: 25,
        scope: { filters: [DATE_ITEM] },
      });
    });
    await waitFor(() => expect(result.current.run.phase).toBe("done"));

    expect(population.collect).toHaveBeenCalledWith(
      expect.objectContaining({ unit: "users", limit: 25 }),
    );
    expect(postBody("/user-sessions")).toEqual({
      project_id: "p1",
      end_user_ids: [U1, U2],
      per_user: 5,
      window: RANGE,
    });
    expect(postBody("/task")).toMatchObject({
      filters: { session_id: ["s1", "s2", "s3"] },
      row_type: "sessions",
      spans_limit: 3,
    });
    expect(postBody("/config").config.instant_eval.unit).toBe("users");
    expect(
      http.get.mock.calls.find(([url]) => url === "/answers")[1].params.unit,
    ).toBe("users");
    expect(result.current.run.asked).toEqual({ users: 2, sessions: 3 });
    expect(result.current.run.answers.rows[0].sessions).toBe(2);
  });
});

describe("useInstantEvalRun on the Traces view", () => {
  it("runs over the view's filters and reads answers and trace metrics", async () => {
    serve({
      progress: { status: "completed", total_count: 1, success_count: 1 },
      answers: {
        rows: [{ id: "t1", time: RANGE[0], answers: answer("No", 0.8) }],
      },
    });
    http.read.mockResolvedValue(
      ok({ table: [{ trace_id: "t1", latency: "1200", status: "OK" }] }),
    );
    const { result } = renderHook(() => useInstantEvalRun("p1", "traces"));
    await act(async () => {
      result.current.start({
        questions: [QUESTION],
        reads: "output",
        limit: 100,
        scope: { filters: [STATUS_ITEM, DATE_ITEM] },
      });
    });
    await waitFor(() => expect(result.current.run.phase).toBe("done"));
    expect(population.collect).not.toHaveBeenCalled();
    expect(postBody("/task")).toMatchObject({
      row_type: "traces",
      spans_limit: 100,
      filters: { date_range: RANGE, filters: [STATUS_ITEM] },
    });
    expect(postBody("/config").mapping).toEqual({ output: "output" });
    expect(result.current.run.metrics.get("t1")).toMatchObject({
      latency: 1200,
      status: "OK",
    });
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
      definitions: {},
      reads: "input_output",
      // Saved before sessions and users had Instant eval.
      unit: "traces",
    });
  });

  it("reuses a saved question only for the same unit and inputs", () => {
    const saved = {
      question: "Did they get what they came for?",
      answerType: "yes_no",
      labels: ["Yes", "No"],
      definitions: {},
      reads: "transcript",
      unit: "sessions",
    };
    const asked = {
      text: "did they get what they came for?",
      answerType: "yes_no",
      labels: ["Yes", "No"],
      definitions: {},
      reads: "transcript",
    };
    expect(matchesSavedQuestion(saved, { ...asked, unit: "sessions" })).toBe(
      true,
    );
    expect(matchesSavedQuestion(saved, { ...asked, unit: "users" })).toBe(
      false,
    );
    expect(
      matchesSavedQuestion(saved, {
        ...asked,
        unit: "sessions",
        definitions: { Yes: "Their issue was resolved" },
      }),
    ).toBe(false);
  });
});

describe("explainErrorGroups", () => {
  it("points key problems at the AI Providers settings", () => {
    const [missing, invalid, missingCode, other] = explainErrorGroups([
      {
        normalized: "Error during evaluation",
        sample:
          "API key not configured for typesafe. Please add your API key in settings.",
        count: 4,
      },
      { normalized: "JEV_KEY_INVALID", count: 2 },
      { normalized: "JEV_KEY_MISSING", count: 3 },
      { normalized: "JEV_RESPONSE_INVALID", count: 1 },
    ]);
    expect(missing).toMatchObject({
      count: 4,
      settingsPath: AI_PROVIDERS_SETTINGS_PATH,
    });
    expect(missing.reason).toMatch(/TypeSafe key/);
    expect(invalid.settingsPath).toBe(AI_PROVIDERS_SETTINGS_PATH);
    expect(missingCode.reason).toMatch(/TypeSafe key/);
    expect(other.reason).toMatch(/Rerun/);
    expect(other.settingsPath).toBeUndefined();
  });
});
