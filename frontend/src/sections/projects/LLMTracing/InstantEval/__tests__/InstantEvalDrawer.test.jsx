import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "src/utils/test-utils";

const harness = vi.hoisted(() => ({
  run: { phase: "idle", items: [], answers: { rows: [] } },
  pastRun: { phase: "idle", items: [], answers: { rows: [] } },
  history: { runs: [], total: 0 },
  start: vi.fn(),
  rerun: vi.fn(),
  view: vi.fn(),
  reset: vi.fn(),
  navigate: vi.fn(),
  jev: { available: true, isLoading: false, reason: null },
  collect: vi.fn(),
}));

vi.mock("src/utils/axios", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  readQuery: vi.fn(),
  endpoints: { project: {}, develop: { eval: {} } },
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => harness.navigate,
}));
vi.mock("src/components/iconify", () => ({ default: () => null }));
vi.mock("../useJevAvailability", () => ({
  useJevAvailability: () => harness.jev,
}));
vi.mock("../useInstantEval", async (importOriginal) => ({
  ...(await importOriginal()),
  // The drawer's second run is its viewer of past runs.
  useInstantEvalRun: (projectId, unit, options) =>
    options?.persist === false
      ? {
          run: harness.pastRun,
          start: vi.fn(),
          rerun: vi.fn(),
          view: harness.view,
          reset: vi.fn(),
        }
      : {
          run: harness.run,
          start: harness.start,
          rerun: harness.rerun,
          view: vi.fn(),
          reset: harness.reset,
        },
  useInstantEvals: () => ({ all: [], items: [], refetch: vi.fn() }),
  useInstantEvalHistory: (projectId, configsById, { search }) => ({
    runs: harness.history.runs.filter((runItem) =>
      runItem.items[0].question
        .toLowerCase()
        .includes((search || "").toLowerCase()),
    ),
    isLoading: false,
    hasMore: false,
    refetch: vi.fn(),
    loadMore: vi.fn(),
  }),
}));
vi.mock("src/sections/projects/observePopulation", async (importOriginal) => ({
  ...(await importOriginal()),
  collectPopulation: harness.collect,
}));

import sessionsResponse from "./fixtures/answers-sessions.json";
import usersResponse from "./fixtures/answers-users.json";
import { normalizeAnswers } from "../instantEvalAnswers";
import InstantEvalDrawer from "../InstantEvalDrawer";

const CONFIG = "22a44112-0680-4a5b-a549-1427ee33c253";
const ITEM = {
  configId: CONFIG,
  templateId: "t1",
  question: "Did the customer get what they came for?",
  answerType: "yes_no",
  labels: ["Yes", "No"],
  definitions: {},
};
const DATE_ITEM = {
  column_id: "created_at",
  filter_config: {
    filter_type: "datetime",
    filter_op: "between",
    filter_value: ["2026-10-08T00:00:00Z", "2026-10-15T00:00:00Z"],
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

const doneRun = (response) => ({
  phase: "done",
  taskId: "task-1",
  items: [ITEM],
  answers: normalizeAnswers(response.result),
  progress: { status: "completed", total: 6, completed: 6, failed: 0 },
  startedAt: "2026-10-15T10:00:00Z",
  finishedAt: "2026-10-15T10:00:12Z",
});

const renderDrawer = (props = {}) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <InstantEvalDrawer
        open
        onClose={vi.fn()}
        projectId="p1"
        unit="sessions"
        scope={{ filters: [STATUS_ITEM, DATE_ITEM], label: "Past 7D" }}
        {...props}
      />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.sessionStorage?.clear();
  harness.run = { phase: "idle", items: [], answers: { rows: [] } };
  harness.pastRun = { phase: "idle", items: [], answers: { rows: [] } };
  harness.history = { runs: [], total: 0 };
  harness.jev = { available: true, isLoading: false, reason: null };
  harness.collect.mockResolvedValue({
    items: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}` })),
    total: 12,
  });
});

describe("InstantEvalDrawer composer", () => {
  it("asks about the sessions in view, reading whole conversations", async () => {
    renderDrawer();
    expect(
      screen.getByText("Ask Jev about every session in this view."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("12 sessions in this view · Past 7D · 1 filter"),
    ).toBeInTheDocument();
    expect(harness.collect).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: "sessions",
        projectId: "p1",
        filters: [STATUS_ITEM, DATE_ITEM],
        limit: 200,
      }),
    );
    // What Jev reads is a choice, explained under it.
    expect(screen.getByText("The conversation")).toBeVisible();
    expect(
      screen.getByText("User and assistant turns, in order"),
    ).toBeInTheDocument();

    const run = screen.getByRole("button", {
      name: "Ask Jev about 12 sessions",
    });
    fireEvent.click(run);
    expect(
      screen.getByText(
        "Write the question Jev should answer for each session.",
      ),
    ).toBeInTheDocument();
    expect(harness.start).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "Question 1" }), {
      target: { value: "Did the customer get what they came for?" },
    });
    fireEvent.click(run);
    expect(harness.start).toHaveBeenCalledWith({
      questions: [
        expect.objectContaining({
          question: "Did the customer get what they came for?",
          answerType: "yes_no",
        }),
      ],
      reads: "transcript",
      limit: 50,
      // The rows just counted are the rows the run asks about.
      scope: {
        filters: [STATUS_ITEM, DATE_ITEM],
        label: "Past 7D · 1 filter",
        handedOver: null,
        population: expect.objectContaining({ total: 12 }),
      },
    });
  });

  it("starts prefilled from a hand-off of chosen sessions", () => {
    renderDrawer({
      seed: {
        unit: "sessions",
        ids: ["a", "b", "c"],
        label: "Refund requests",
        questions: [
          { question: "Was a refund promised?", answerType: "yes_no" },
        ],
      },
      seedKey: "k1",
    });
    expect(
      screen.getByText("3 sessions from Refund requests"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Was a refund promised?")).toBeVisible();
    expect(harness.collect).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Ask Jev about 3 sessions" }),
    );
    expect(harness.start.mock.calls[0][0].scope.handedOver).toEqual({
      ids: ["a", "b", "c"],
      label: "Refund requests",
    });
  });

  it("points to AI Providers and keeps Run disabled without a key", () => {
    harness.jev = {
      available: false,
      isLoading: false,
      reason: "Jev runs on your own TypeSafe key.",
      settingsPath: "/dashboard/settings/ai-providers",
    };
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Open AI Providers" }));
    expect(harness.navigate).toHaveBeenCalledWith(
      "/dashboard/settings/ai-providers",
    );
    expect(
      screen.getByRole("button", { name: /Ask Jev about/ }),
    ).toBeDisabled();
  });
});

describe("InstantEvalDrawer results", () => {
  it("shows the distribution, flags unsure answers and opens a session", () => {
    harness.run = doneRun(sessionsResponse);
    const onOpenRow = vi.fn();
    renderDrawer({ onOpenRow });
    expect(screen.getByText("6 sessions answered in 12 s")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Yes: 4 sessions, 67%" }),
    ).toBeInTheDocument();
    expect(screen.getByText("6 sessions")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Jev was unsure on 4" }),
    );
    expect(screen.getByText("4 sessions")).toBeInTheDocument();

    fireEvent.click(screen.getByText("I need to speak to a human. Now."));
    expect(onOpenRow).toHaveBeenCalledWith(
      expect.objectContaining({ id: "449c2494-769c-55de-b8c7-7e79c70372d3" }),
    );
  });

  it("hands the users who answered No to a new Insights report", () => {
    harness.run = doneRun(usersResponse);
    renderDrawer({ unit: "users" });
    expect(screen.getByText("cust_kai_278")).toBeInTheDocument();
    expect(screen.getByText(/2 sessions · Yes 2/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "No: 2 users, 40%" }));
    const rows = screen.getByText("2 users").parentElement.nextSibling;
    expect(within(rows).getByText("cust_ines_979")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Find patterns in these 2 “No” users",
      }),
    );
    const link = harness.navigate.mock.calls[0][0];
    expect(link).toMatch(/^\/dashboard\/observe\/p1\/insights\?new=1&seed=/);
    const key = new URLSearchParams(link.split("?")[1]).get("seed");
    const seed = JSON.parse(
      globalThis.sessionStorage.getItem(`observe-handoff:${key}`),
    );
    expect(seed).toMatchObject({
      unit: "users",
      question:
        "Why did these users get “No” for “Did the customer get what they came for?”?",
      source: "Instant eval: Did the customer get what they came for?",
    });
    expect(seed.population.map((row) => row.user_id)).toEqual([
      "cust_ines_979",
      "cust_priya_597",
    ]);
  });

  it("offers Show in grid for traces", () => {
    harness.run = {
      ...doneRun(sessionsResponse),
      scopeFilters: [DATE_ITEM],
    };
    const onShowInGrid = vi.fn();
    renderDrawer({ unit: "traces", onShowInGrid });
    fireEvent.click(screen.getByRole("button", { name: "No: 2 traces, 33%" }));
    fireEvent.click(screen.getByRole("button", { name: "Show in grid" }));
    expect(onShowInGrid).toHaveBeenCalledWith(
      expect.objectContaining({
        column_id: CONFIG,
        filter_config: expect.objectContaining({ filter_value: ["No"] }),
      }),
    );
    expect(
      screen.getByRole("button", { name: "Keep answering new traces" }),
    ).toBeInTheDocument();
  });

  it("runs the same questions again over the current view", async () => {
    harness.run = { ...doneRun(sessionsResponse), limit: 25 };
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    await waitFor(() =>
      expect(harness.rerun).toHaveBeenCalledWith({
        items: [ITEM],
        limit: 25,
        scope: {
          filters: [STATUS_ITEM, DATE_ITEM],
          label: "Past 7D · 1 filter",
          handedOver: null,
        },
      }),
    );
  });
});

describe("InstantEvalDrawer reads", () => {
  it("lets a span question read the span's output only", async () => {
    renderDrawer({ unit: "spans", scope: { filters: [], label: "Past 7D" } });
    expect(
      screen.getByText("Ask Jev about every span in this view."),
    ).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /Jev reads/ }));
    const options = within(screen.getByRole("listbox"));
    expect(
      options.getAllByRole("option").map((option) => option.textContent),
    ).toEqual([
      "Span input and outputThis span's own input and output",
      "Input onlyThis span's own input",
      "Output onlyThis span's own output",
    ]);
    fireEvent.click(options.getByText("Output only"));
    fireEvent.change(screen.getByRole("textbox", { name: "Question 1" }), {
      target: { value: "Is the answer grounded?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask Jev about/ }));
    expect(harness.start).toHaveBeenCalledWith(
      expect.objectContaining({ reads: "output", limit: 50 }),
    );
  });

  it("offers the whole trace on the Traces view", async () => {
    renderDrawer({ unit: "traces" });
    const reads = screen.getByRole("combobox", { name: /Jev reads/ });
    expect(reads).toHaveTextContent("Input and output");
    fireEvent.mouseDown(reads);
    fireEvent.click(
      within(screen.getByRole("listbox")).getByText("The whole trace"),
    );
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(reads).toHaveTextContent("The whole trace");
    expect(
      screen.getByText(
        "Every span: LLM calls, tool calls and results, retrieval, errors",
      ),
    ).toBeInTheDocument();
  });
});

describe("InstantEvalDrawer while Jev reads", () => {
  it("lists every row from the start and fills answers in as they land", () => {
    const started = new Date(Date.now() - 8000).toISOString();
    const answers = normalizeAnswers({
      rows: [
        {
          id: "s1",
          excerpt: "Where is my order?",
          answers: { [CONFIG]: { answer: "Yes", status: "completed" } },
        },
        {
          id: "s2",
          excerpt: "I want a refund",
          answers: { [CONFIG]: { answer: null, status: "running" } },
        },
      ],
    });
    harness.run = {
      phase: "running",
      taskId: "task-1",
      items: [ITEM],
      answers,
      asked: { rows: 3 },
      placeholders: [{ id: "s1" }, { id: "s2" }, { id: "s3", user_id: "u3" }],
      startedAt: started,
    };
    renderDrawer();
    expect(
      screen.getByText(/^1 of 3 sessions answered · (8|9) s$/),
    ).toBeInTheDocument();
    expect(screen.getByText("3 sessions")).toBeInTheDocument();
    expect(screen.getAllByText("Reading…")).toHaveLength(2);
    expect(screen.getByText("Still reading")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Yes: 1 sessions, 100%" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run again" })).toBeNull();
  });
});

describe("InstantEvalDrawer History", () => {
  const SPAN_ITEM = { ...ITEM, unit: "sessions", reads: "transcript_full" };
  const past = (taskId, question, extra = {}) => ({
    taskId,
    status: "completed",
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    items: [{ ...SPAN_ITEM, question }],
    unit: "sessions",
    reads: "transcript_full",
    rows: 50,
    counts: { [CONFIG]: { Yes: 4, No: 2 } },
    answered: 50,
    pending: 0,
    ...extra,
  });

  it("lists past runs with their answer split and opens one", async () => {
    harness.history = {
      runs: [
        past("k1", "Did the customer get what they came for?"),
        past("k2", "Was a refund promised?", {
          status: "running",
          rows: 6,
          answered: 2,
          pending: 4,
          counts: {},
        }),
      ],
    };
    renderDrawer();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(
      screen.getByText(
        "50 sessions · The whole session · 4 min ago · Completed",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^2 of 6 sessions answered · .* · Running$/),
    ).toBeInTheDocument();
    expect(screen.getByText("Reading…")).toBeInTheDocument();
    // The first question's split, from the run's own counts.
    expect(
      screen.getByRole("img", { name: "Answers: Yes 4 · No 2" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Yes 67%")).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search past questions" }),
      { target: { value: "refund" } },
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Did the customer get what they came for?"),
      ).toBeNull(),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search past questions" }),
      { target: { value: "" } },
    );
    await screen.findByText("Did the customer get what they came for?");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open the run: Did the customer get what they came for?",
      }),
    );
    expect(harness.view).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "k1",
        asked: { rows: 50 },
        items: [expect.objectContaining({ configId: CONFIG })],
      }),
    );
  });

  it("shows an opened run and asks its questions again over this view", async () => {
    harness.history = { runs: [past("k1", ITEM.question)] };
    harness.pastRun = { ...doneRun(sessionsResponse), viewing: true };
    renderDrawer();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    fireEvent.click(
      screen.getByRole("button", { name: `Open the run: ${ITEM.question}` }),
    );
    expect(screen.getByText(/^6 sessions answered · ran /)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Ask again on this view" }),
    );
    expect(harness.rerun).toHaveBeenCalledWith({
      items: [ITEM],
      limit: 50,
      scope: {
        filters: [STATUS_ITEM, DATE_ITEM],
        label: "Past 7D · 1 filter",
        handedOver: null,
      },
    });
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("says when a view has no past runs yet", () => {
    renderDrawer({ unit: "traces" });
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(
      screen.getByText(/No Instant eval runs on traces yet/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Trace answers also stay on the Traces grid/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }));
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
