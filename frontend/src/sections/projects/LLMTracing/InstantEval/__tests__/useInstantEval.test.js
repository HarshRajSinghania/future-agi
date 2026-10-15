import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      instantEvalRuns: () => "/runs",
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
  historyRun,
  itemFromConfig,
  matchesSavedQuestion,
  useInstantEvalHistory,
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

// A backend that saves one evaluator ("c1") and answers the task. `answers`
// may be a list: one answers response per read, the last one repeating.
function serve({ answers, progress, userSessions }) {
  const answerReads = Array.isArray(answers) ? answers : [answers];
  let read = 0;
  http.get.mockImplementation((url) => {
    if (url === "/configs") return Promise.resolve(ok([]));
    if (url === "/logs") return Promise.resolve(ok(progress));
    if (url === "/answers") {
      const next = answerReads[Math.min(read, answerReads.length - 1)];
      read += 1;
      return Promise.resolve(ok(next));
    }
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
const getCalls = (url) =>
  http.get.mock.calls.filter(([called]) => called === url);

const answer = (value, confidence) => ({
  c1: { answer: value, explanation: "", confidence, status: "completed" },
});
const reading = { c1: { answer: null, explanation: "", status: "running" } };

// Runs the run's polls (1 s, then every 1.5 s) until it settles.
async function untilDone(result, maxTicks = 30) {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (["done", "failed"].includes(result.current.run.phase)) return;
    // eslint-disable-next-line no-await-in-loop
    await act(() => vi.advanceTimersByTimeAsync(500));
  }
}

const start = (result, args) =>
  act(async () => {
    result.current.start({ questions: [QUESTION], ...args });
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  globalThis.sessionStorage?.clear();
});
afterEach(() => {
  vi.useRealTimers();
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
        pending: 0,
      },
    });
    const { result } = renderHook(() => useInstantEvalRun("p1", "sessions"));
    await start(result, {
      reads: "input_output",
      limit: 50,
      scope: { filters: [STATUS_ITEM, DATE_ITEM], label: "Past 7D" },
    });
    await untilDone(result);
    expect(result.current.run.phase).toBe("done");

    expect(population.collect).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: "sessions",
        projectId: "p1",
        filters: [STATUS_ITEM, DATE_ITEM],
        limit: 50,
      }),
    );
    // Sessions read their conversation, whatever was asked for.
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
    expect(getCalls("/answers")[0][1]).toEqual({
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
    expect(result.current.run.asked).toEqual({ rows: 2 });
    expect(result.current.run.placeholders).toEqual([
      { id: "s1" },
      { id: "s2" },
    ]);
  });

  it("reads whole sessions, steps included, when asked to", async () => {
    population.collect.mockResolvedValue({ items: [{ id: "s1" }], total: 1 });
    serve({
      progress: { status: "completed", total_count: 1, success_count: 1 },
      answers: { rows: [{ id: "s1", answers: answer("Yes") }], pending: 0 },
    });
    const { result } = renderHook(() => useInstantEvalRun("p1", "sessions"));
    await start(result, {
      reads: "transcript_full",
      limit: 50,
      scope: { filters: [DATE_ITEM] },
    });
    await untilDone(result);
    expect(postBody("/template").instructions).toBe(
      "Did the customer get what they came for?\n\nConversation:\n{{conversation}}",
    );
    expect(postBody("/config").mapping).toEqual({
      conversation: "transcript_full",
    });
    expect(postBody("/config").config.instant_eval.reads).toBe(
      "transcript_full",
    );
  });

  it("finishes without a task when no sessions are in view", async () => {
    population.collect.mockResolvedValue({ items: [], total: 0 });
    serve({});
    const { result } = renderHook(() => useInstantEvalRun("p1", "sessions"));
    await start(result, { limit: 50, scope: { filters: [DATE_ITEM] } });
    await untilDone(result);
    expect(result.current.run.phase).toBe("done");
    expect(result.current.run.empty).toMatch(/no sessions in this view/);
    expect(postBody("/task")).toBeUndefined();
  });

  it("asks about the rows the drawer just counted, without reading again", async () => {
    serve({
      progress: { status: "completed", total_count: 2, success_count: 2 },
      answers: {
        rows: [
          { id: "s3", answers: answer("Yes") },
          { id: "s4", answers: answer("No") },
        ],
        pending: 0,
      },
    });
    const { result } = renderHook(() => useInstantEvalRun("p1", "sessions"));
    await start(result, {
      limit: 2,
      scope: {
        filters: [DATE_ITEM],
        population: {
          items: [{ id: "s3" }, { id: "s4" }, { id: "s5" }],
          total: 3,
        },
      },
    });
    await untilDone(result);
    expect(population.collect).not.toHaveBeenCalled();
    expect(postBody("/task").filters).toEqual({ session_id: ["s3", "s4"] });
  });

  it("streams answers in and ends once every row is answered", async () => {
    population.collect.mockResolvedValue({
      items: [{ id: "s1" }, { id: "s2" }],
      total: 2,
    });
    serve({
      // The task never reports an end: the answers alone finish the run.
      progress: { status: "running", total_count: 2, success_count: 1 },
      answers: [
        { rows: [], pending: 0 },
        {
          rows: [
            { id: "s1", answers: answer("Yes", 0.9) },
            { id: "s2", answers: reading },
          ],
          pending: 1,
        },
        {
          rows: [
            { id: "s1", answers: answer("Yes", 0.9) },
            { id: "s2", answers: answer("No", 0.8) },
          ],
          pending: 0,
        },
      ],
    });
    const { result } = renderHook(() => useInstantEvalRun("p1", "sessions"));
    await start(result, { limit: 50, scope: { filters: [DATE_ITEM] } });
    // Every row is on screen before Jev has answered any.
    expect(result.current.run.placeholders).toHaveLength(2);
    // The first read lands within the first second.
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(getCalls("/answers")).toHaveLength(1);
    // Then every 2 s.
    await act(() => vi.advanceTimersByTimeAsync(1900));
    expect(getCalls("/answers")).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(result.current.run.phase).toBe("running");
    expect(result.current.run.answers).toMatchObject({
      answered: 1,
      pending: 1,
    });
    await untilDone(result);
    expect(result.current.run.phase).toBe("done");
    expect(result.current.run.answers.answered).toBe(2);
    expect(getCalls("/answers")).toHaveLength(3);
    expect(result.current.run.finishedAt).toBeTruthy();
  });

  it("never starts a poll before the last one has finished", async () => {
    population.collect.mockResolvedValue({ items: [{ id: "s1" }], total: 1 });
    serve({
      progress: { status: "running", total_count: 1 },
      answers: { rows: [{ id: "s1", answers: answer("Yes") }], pending: 0 },
    });
    const serveAll = http.get.getMockImplementation();
    let release;
    http.get.mockImplementation((url, config) => {
      // The first answers read hangs for 5 s.
      if (url === "/answers" && !release)
        return new Promise((resolve) => {
          release = () => resolve(serveAll(url, config));
        });
      return serveAll(url, config);
    });
    const { result } = renderHook(() => useInstantEvalRun("p1", "sessions"));
    await start(result, { limit: 50, scope: { filters: [DATE_ITEM] } });
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(getCalls("/answers")).toHaveLength(1);
    expect(getCalls("/logs")).toHaveLength(1);
    await act(async () => release());
    await untilDone(result);
    expect(result.current.run.phase).toBe("done");
    expect(getCalls("/answers")).toHaveLength(1);
  });

  it("keeps following through a backend restart", async () => {
    population.collect.mockResolvedValue({ items: [{ id: "s1" }], total: 1 });
    serve({
      progress: { status: "running", total_count: 1 },
      answers: { rows: [{ id: "s1", answers: answer("Yes") }], pending: 0 },
    });
    const serveAnswers = http.get.getMockImplementation();
    let down = 3;
    http.get.mockImplementation((url, config) => {
      if (url === "/answers" && down > 0) {
        down -= 1;
        return Promise.reject(new Error("Network Error"));
      }
      return serveAnswers(url, config);
    });
    const { result } = renderHook(() => useInstantEvalRun("p1", "sessions"));
    await start(result, { limit: 50, scope: { filters: [DATE_ITEM] } });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.run).toMatchObject({
      phase: "running",
      reconnecting: true,
    });
    await untilDone(result, 60);
    expect(result.current.run).toMatchObject({
      phase: "done",
      reconnecting: false,
    });
    expect(result.current.run.error).toBeUndefined();
    expect(result.current.run.answers.answered).toBe(1);
  });

  it("reopens the last finished run from session storage", async () => {
    population.collect.mockResolvedValue({ items: [{ id: "s1" }], total: 1 });
    serve({
      progress: { status: "completed", total_count: 1, success_count: 1 },
      answers: {
        rows: [{ id: "s1", answers: answer("Yes", 0.9), time: RANGE[0] }],
        pending: 0,
      },
    });
    const first = renderHook(() => useInstantEvalRun("p1", "sessions"));
    await start(first.result, { limit: 25, scope: { filters: [DATE_ITEM] } });
    await untilDone(first.result);
    expect(first.result.current.run.phase).toBe("done");
    first.unmount();

    http.get.mockClear();
    const again = renderHook(() => useInstantEvalRun("p1", "sessions"));
    expect(again.result.current.run).toMatchObject({
      phase: "done",
      taskId: "task-1",
    });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(again.result.current.run.answers.rows).toHaveLength(1);
    // One answers read, no progress polling for a finished run.
    expect(http.get.mock.calls.map(([url]) => url)).toEqual(["/answers"]);
    // Another unit of the same project starts clean.
    const users = renderHook(() => useInstantEvalRun("p1", "users"));
    expect(users.result.current.run.phase).toBe("idle");
    // A viewer of past runs never takes the slot.
    const viewer = renderHook(() =>
      useInstantEvalRun("p1", "sessions", { persist: false }),
    );
    expect(viewer.result.current.run.phase).toBe("idle");
  });
});

describe("useInstantEvalRun on the Users view", () => {
  it("answers each user's latest sessions and reads the answers per user", async () => {
    population.collect.mockResolvedValue({
      items: [
        { id: U1, user_id: "cust_kai" },
        { id: U2, user_id: "cust_ines" },
        { id: "not-a-uuid" },
      ],
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
            answers: {
              c1: { answer: "Yes", counts: { Yes: 2 }, status: "completed" },
            },
          },
          {
            id: U2,
            label: "cust_ines",
            sessions: 1,
            answers: {
              c1: { answer: "No", counts: { No: 1 }, status: "completed" },
            },
          },
        ],
        pending: 0,
      },
    });
    const { result } = renderHook(() => useInstantEvalRun("p1", "users"));
    await start(result, { limit: 25, scope: { filters: [DATE_ITEM] } });
    await untilDone(result);
    expect(result.current.run.phase).toBe("done");

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
    expect(getCalls("/answers")[0][1].params.unit).toBe("users");
    expect(result.current.run.asked).toEqual({
      rows: 2,
      users: 2,
      sessions: 3,
    });
    // Only users with a session in the window wait for an answer.
    expect(result.current.run.placeholders.map((row) => row.id)).toEqual([
      U1,
      U2,
    ]);
    expect(result.current.run.answers.rows[0].sessions).toBe(2);
  });
});

describe("useInstantEvalRun on the Traces view", () => {
  it("names the newest traces in view and reads the whole trace", async () => {
    population.collect.mockResolvedValue({
      items: [{ id: "t1" }, { id: "t2" }],
      total: 40,
    });
    serve({
      progress: { status: "completed", total_count: 2, success_count: 2 },
      answers: {
        rows: [
          { id: "t1", time: RANGE[0], answers: answer("No", 0.8) },
          { id: "t2", time: RANGE[0], answers: answer("Yes", 0.9) },
        ],
        pending: 0,
      },
    });
    http.read.mockResolvedValue(
      ok({ table: [{ trace_id: "t1", latency: "1200", status: "OK" }] }),
    );
    const { result } = renderHook(() => useInstantEvalRun("p1", "traces"));
    await start(result, {
      reads: "trace_tree",
      limit: 50,
      scope: { filters: [STATUS_ITEM, DATE_ITEM] },
    });
    await untilDone(result);
    expect(result.current.run.phase).toBe("done");
    expect(population.collect).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: "traces",
        filters: [STATUS_ITEM, DATE_ITEM],
        limit: 50,
      }),
    );
    // Explicit ids, nothing beside them: the backend's fast path.
    expect(postBody("/task")).toMatchObject({
      row_type: "traces",
      spans_limit: 2,
      filters: { trace_id: ["t1", "t2"] },
    });
    expect(postBody("/config").mapping).toEqual({
      whole_trace: "trace_tree",
    });
    expect(postBody("/template").instructions).toContain(
      "Trace:\n{{whole_trace}}",
    );
    // The live task, if asked for, keeps the view's own filters.
    expect(result.current.run.scopeFilters).toEqual([STATUS_ITEM, DATE_ITEM]);
    // Latency and cost come from the trace list, by id.
    const metricsRequest = http.read.mock.calls[0][1].params;
    expect(JSON.parse(metricsRequest.filters)[0]).toMatchObject({
      column_id: "trace_id",
      filter_config: { filter_op: "in", filter_value: ["t1", "t2"] },
    });
    expect(result.current.run.metrics.get("t1")).toMatchObject({
      latency: 1200,
      status: "OK",
    });
  });
});

describe("useInstantEvalRun on the Spans tab", () => {
  it("names the spans in view and reads each span on its own", async () => {
    population.collect.mockResolvedValue({
      items: [{ id: "sp1", trace_id: "t1" }],
      total: 1,
    });
    serve({
      progress: { status: "completed", total_count: 1, success_count: 1 },
      answers: {
        unit: "spans",
        rows: [
          {
            id: "sp1",
            trace_id: "t1",
            excerpt: "llm · ChatCompletion: hi",
            answers: answer("Yes"),
          },
        ],
        pending: 0,
      },
    });
    const { result } = renderHook(() => useInstantEvalRun("p1", "spans"));
    await start(result, { reads: "input_output", limit: 50, scope: {} });
    await untilDone(result);
    expect(result.current.run.phase).toBe("done");
    expect(postBody("/task")).toMatchObject({
      row_type: "spans",
      filters: { span_id: ["sp1"] },
      spans_limit: 1,
    });
    expect(postBody("/config").mapping).toEqual({
      input: "input",
      output: "output",
    });
    expect(postBody("/template").instructions).toContain("Span input:");
    expect(postBody("/config").config.instant_eval).toMatchObject({
      unit: "spans",
      reads: "input_output",
    });
    expect(getCalls("/answers")[0][1].params.unit).toBe("spans");
    expect(result.current.run.answers.rows[0]).toMatchObject({
      id: "sp1",
      traceId: "t1",
    });
    // Span runs have no trace metrics.
    expect(http.read).not.toHaveBeenCalled();
  });
});

describe("History", () => {
  const configsById = {
    c1: {
      configId: "c1",
      name: "Refund promised?",
      question: "Refund promised?",
      answerType: "yes_no",
      labels: ["Yes", "No"],
      unit: "sessions",
      reads: "transcript",
      templateId: "t1",
    },
  };
  const run = (taskId, extra = {}) => ({
    task_id: taskId,
    name: "Instant eval · Refund promised?",
    created_at: "2026-10-15T10:00:00Z",
    status: "completed",
    run_type: "historical",
    unit: "sessions",
    reads: "transcript",
    rows: 6,
    config_ids: ["c1"],
    questions: ["Refund promised?"],
    counts: { c1: { Yes: 4, No: 2 } },
    answered: 6,
    pending: 0,
    ...extra,
  });

  it("rebuilds a past run from the runs endpoint and its evaluators", () => {
    expect(historyRun(run("k1"), configsById)).toEqual({
      taskId: "k1",
      name: "Instant eval · Refund promised?",
      status: "completed",
      createdAt: "2026-10-15T10:00:00Z",
      unit: "sessions",
      reads: "transcript",
      rows: 6,
      items: [configsById.c1],
      counts: { c1: { Yes: 4, No: 2 } },
      answered: 6,
      pending: 0,
    });
    // An evaluator that is gone still reads from what the run counted.
    expect(
      historyRun(
        run("k2", {
          config_ids: ["gone"],
          questions: ["Why did they call?"],
          counts: { gone: { Refund: 3, Shipping: 1, __error__: 1 } },
        }),
        configsById,
      ).items,
    ).toEqual([
      {
        configId: "gone",
        question: "Why did they call?",
        answerType: "category",
        labels: ["Refund", "Shipping"],
        definitions: {},
      },
    ]);
  });

  it("reads this view's runs page by page, searching by question", async () => {
    http.get.mockResolvedValue(
      ok({
        runs: [
          run("new"),
          run("old", { created_at: "2026-10-14T10:00:00Z" }),
          run("live", { run_type: "continuous" }),
        ],
        has_more: true,
      }),
    );
    vi.useRealTimers();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }) =>
      React.createElement(QueryClientProvider, { client }, children);
    const { result, rerender } = renderHook(
      ({ search }) =>
        useInstantEvalHistory("p1", configsById, { unit: "sessions", search }),
      { wrapper, initialProps: { search: "" } },
    );
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.runs.map((runItem) => runItem.taskId)).toEqual([
      "new",
      "old",
    ]);
    expect(result.current.hasMore).toBe(true);
    expect(http.get).toHaveBeenCalledWith("/runs", {
      params: {
        project_id: "p1",
        unit: "sessions",
        page_number: 0,
        page_size: 20,
      },
      signal: expect.anything(),
    });
    // No eval-task list scan, no answers read per row.
    expect(getCalls("/tasks")).toHaveLength(0);
    expect(getCalls("/answers")).toHaveLength(0);

    rerender({ search: "refund" });
    await vi.waitFor(() =>
      expect(http.get).toHaveBeenLastCalledWith("/runs", {
        params: {
          project_id: "p1",
          unit: "sessions",
          search: "refund",
          page_number: 0,
          page_size: 20,
        },
        signal: expect.anything(),
      }),
    );
    await vi.waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(() => result.current.loadMore());
    expect(http.get.mock.calls.at(-1)[1].params.page_number).toBe(1);
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
