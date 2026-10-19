/* eslint-disable react/prop-types */
import React from "react";
import PropTypes from "prop-types";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { palette } from "src/theme/palette";
import { askLink } from "src/sections/projects/observeHandoff";

const fakes = vi.hoisted(() => ({
  startAskRun: vi.fn(),
  estimate: vi.fn(),
  runs: [],
  // useAskRun's answer, by task id; a run being created has none.
  askRuns: {},
  askRunArgs: [],
  rowsArgs: [],
  control: vi.fn(),
}));

vi.mock("src/components/iconify", () => ({ default: () => null }));
// The views' filter panel: here it applies a Status filter, as a pick in it
// would.
vi.mock("src/sections/projects/LLMTracing/TraceFilterPanel", () => ({
  default: ({ onApply, onClose, currentFilters }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onApply([
            ...(currentFilters || []),
            {
              field: "status",
              fieldCategory: "system",
              fieldType: "string",
              apiColType: "SYSTEM_METRIC",
              operator: "equals",
              value: "ERROR",
            },
          ])
        }
      >
        Pick status ERROR
      </button>
      <button type="button" onClick={onClose}>
        Close panel
      </button>
    </div>
  ),
}));
vi.mock("src/components/traceDetail/TraceDetailDrawerV2", () => ({
  default: () => null,
}));
vi.mock("../../results/KeepAnswering", () => ({ default: () => null }));
vi.mock("../../useJevAvailability", () => ({
  useJevAvailability: () => ({ available: true, isLoading: false }),
}));
vi.mock("../../useInstantEval", async (importOriginal) => ({
  ...(await importOriginal()),
  startAskRun: fakes.startAskRun,
  estimateAsk: fakes.estimate,
  useInstantEvals: () => ({ all: [], items: [], isLoading: false }),
  useInstantEvalHistory: () => ({
    runs: fakes.runs,
    isLoading: false,
    isError: false,
    hasMore: false,
    loadMore: () => {},
    refetch: () => {},
  }),
}));
vi.mock("../useAskRun", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAskRun: (args) => {
      fakes.askRunArgs.push(args);
      const { taskId, unit, questions, startedAt } = args;
      return (
        fakes.askRuns[taskId] || {
          taskId: taskId || null,
          status: "loading",
          summary: null,
          startedAt,
          elapsedMs: 0,
          answered: 0,
          failed: 0,
          pending: 0,
          notRead: 0,
          total: 0,
          questions: (questions || []).map((q) => ({ configId: "", ...q })),
          records: null,
          sample: null,
          window: null,
          unit,
          reads: null,
          refetch: () => {},
          control: fakes.control,
        }
      );
    },
  };
});
// The rows the table pages through, filtered as the charts select.
vi.mock("../useAskRows", () => ({
  useAskRows: (args) => {
    fakes.rowsArgs.push(args);
    const run = Object.values(fakes.askRuns).find(
      (item) => item.taskId === args.taskId,
    );
    const all = run?.records || [];
    const { filter } = args;
    const rows = all.filter(
      (record) =>
        (!filter?.answer ||
          record.answers[filter.config_id]?.answer === filter.answer) &&
        (!filter?.time_from ||
          (record.time >= filter.time_from && record.time < filter.time_to)),
    );
    return {
      rows,
      total: rows.length,
      isLoading: false,
      hasMore: false,
      isFetchingMore: false,
      loadMore: () => {},
    };
  },
  fetchRowIds: vi.fn(async () => []),
  downloadRowsCsv: vi.fn(),
}));
// The charts are B's; here they only stand in for a click on them.
vi.mock("../viz", async (importOriginal) => ({
  ...(await importOriginal()),
  AskTimeline: ({ records, summary, onSelect, onFocus, questions }) => (
    <div data-testid="timeline">
      <span>{records ? `${records.length} squares` : "columns"}</span>
      <span>{summary ? `${summary.total} counted` : "nothing counted"}</span>
      <button
        type="button"
        onClick={() =>
          onSelect(
            {
              time_from: "2026-10-13T14:00:00Z",
              time_to: "2026-10-13T16:00:00Z",
            },
            "Tue Oct 13, 2–4 PM",
          )
        }
      >
        Select the outage
      </button>
      <button
        type="button"
        onClick={() =>
          onFocus({ configId: questions[0].configId, answer: "No" })
        }
      >
        Focus No
      </button>
    </div>
  ),
  AskPatterns: () => null,
  AskHeatmap: () => null,
}));

import AskPage from "../AskPage";
import {
  presetWindow,
  viewSeed,
  windowItem,
} from "src/sections/projects/observeScope";

const PROJECT = "p1";
const CONFIG = "config-1";
const QUESTION = "Did the agent resolve the customer's issue?";
const POPULATION = [
  { id: "s1", time: "2026-10-13T14:10:00Z", user_id: "cust_ada" },
  { id: "s2", time: "2026-10-13T15:20:00Z", user_id: "cust_ben" },
  { id: "s3", time: "2026-10-14T09:00:00Z", user_id: "cust_kai" },
];

const theme = createTheme({ palette: palette("light") });

function Where() {
  const location = useLocation();
  return (
    <output data-testid="where">{location.pathname + location.search}</output>
  );
}

const where = () => {
  const url = new URL(
    screen.getByTestId("where").textContent,
    "http://app.test",
  );
  return { path: url.pathname, params: Object.fromEntries(url.searchParams) };
};

function renderAt(path) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Shell = ({ children }) => (
    <QueryClientProvider client={client}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </QueryClientProvider>
  );
  Shell.propTypes = { children: PropTypes.node };
  return render(
    <Shell>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/dashboard/observe/:observeId/ask"
            element={
              <>
                <AskPage />
                <Where />
              </>
            }
          />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </Shell>,
  );
}

const answered = (id, time, user, answer) => ({
  id,
  unit: "sessions",
  time,
  user_id: user,
  end_user_id: "",
  label: id,
  excerpt: `Where is my order? (${id})`,
  trace_id: null,
  facets: {
    model: "gpt-4o-mini",
    turns: 1,
    duration_ms: 2000,
    error: answer === "No",
  },
  answers: {
    [CONFIG]: { answer, confidence: 0.9, explanation: "", status: "completed" },
  },
});

const QUESTIONS = [
  {
    configId: CONFIG,
    question: QUESTION,
    answerType: "yes_no",
    labels: ["Yes", "No"],
  },
];

const runOf = ({
  status = "done",
  total = 3,
  answered: done = 3,
  failed = 0,
  sample = null,
  records,
} = {}) => ({
  taskId: "task-sessions",
  status,
  startedAt: "2026-10-15T10:00:00Z",
  elapsedMs: 21000,
  answered: done,
  failed,
  pending: total - done - failed,
  notRead: 0,
  total,
  rate: status === "running" ? 152 : null,
  eta: status === "running" ? 240 : null,
  createdBy: { name: "Nikhil", email: "n@example.com" },
  questions: QUESTIONS,
  records:
    records === undefined
      ? [
          answered("s3", "2026-10-14T09:00:00Z", "cust_kai", "Yes"),
          answered("s2", "2026-10-13T15:20:00Z", "cust_ben", "No"),
          answered("s1", "2026-10-13T14:10:00Z", "cust_ada", "No"),
        ]
      : records,
  sample,
  summary: {
    total,
    credits_estimate: 0.18,
    counts: { [CONFIG]: { Yes: 620, No: 380, __error__: failed } },
    sample,
    scope: { filters: [], sample_size: sample?.requested ?? null, ids: null },
  },
  window: ["2026-10-13T14:10:00Z", "2026-10-14T09:00:00Z"],
  unit: "sessions",
  reads: "transcript",
  tz: "UTC",
  refetch: () => {},
  control: fakes.control,
});

const doneRun = runOf();

const ESTIMATE = {
  population: 104233,
  population_is_lower_bound: false,
  rows_to_read: 1000,
  questions: 1,
  credits_estimate: 60,
  seconds_estimate: 210,
  needs_confirm: false,
  max_rows: 100000,
  confirm_rows: 5000,
  default_sample_size: 1000,
  sessions_per_user: null,
  choices: [
    {
      sample_size: 500,
      rows_to_read: 500,
      seconds_estimate: 110,
      needs_confirm: false,
      allowed: true,
    },
    {
      sample_size: 1000,
      rows_to_read: 1000,
      seconds_estimate: 210,
      needs_confirm: false,
      allowed: true,
    },
    {
      sample_size: 2000,
      rows_to_read: 2000,
      seconds_estimate: 410,
      needs_confirm: false,
      allowed: true,
    },
    {
      sample_size: 5000,
      rows_to_read: 5000,
      seconds_estimate: 1010,
      needs_confirm: false,
      allowed: true,
    },
    {
      sample_size: null,
      rows_to_read: 104233,
      seconds_estimate: 20857,
      needs_confirm: true,
      allowed: false,
    },
  ],
};

const smallEstimate = (count) => ({
  ...ESTIMATE,
  population: count,
  default_sample_size: null,
  choices: [
    {
      sample_size: null,
      rows_to_read: count,
      seconds_estimate: 10 + count * 0.2,
      needs_confirm: count > 5000,
      allowed: true,
    },
  ],
});

const historyItem = (taskId, unit, question) => ({
  taskId,
  name: `Instant eval · ${question}`,
  status: "completed",
  createdAt: new Date().toISOString(),
  unit,
  reads: "trace",
  rows: 50,
  items: [
    {
      configId: `${taskId}-config`,
      question,
      answerType: "yes_no",
      labels: ["Yes", "No"],
    },
  ],
  counts: { [`${taskId}-config`]: { Yes: 25, No: 25 } },
  answered: 50,
  pending: 0,
});

beforeEach(() => {
  fakes.startAskRun.mockReset();
  fakes.estimate.mockReset();
  fakes.estimate.mockResolvedValue(ESTIMATE);
  fakes.control.mockReset();
  fakes.control.mockResolvedValue({ status: "paused", message: "Paused." });
  fakes.runs = [];
  fakes.askRuns = {};
  fakes.askRunArgs = [];
  fakes.rowsArgs = [];
  globalThis.sessionStorage?.clear?.();
  globalThis.localStorage?.clear?.();
});

describe("the Ask page", () => {
  it("reads a sample of a big view by default and opens the run", async () => {
    let finishStart;
    fakes.startAskRun.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStart = resolve;
        }),
    );
    const filters = [
      {
        column_id: "created_at",
        filter_config: {
          filter_type: "datetime",
          filter_op: "between",
          filter_value: [
            "2026-10-08T00:00:00.000Z",
            "2026-10-15T00:00:00.000Z",
          ],
        },
      },
    ];
    renderAt(
      askLink(PROJECT, {
        unit: "sessions",
        label: "Custom range",
        dateOption: "Custom",
        filters,
      }),
    );
    expect(where().params).toMatchObject({ new: "1", tab: "sessions" });
    expect(
      await screen.findByText(/104,233 sessions in the Sessions view/),
    ).toBeInTheDocument();
    // The server counted the view with its own filters.
    expect(fakes.estimate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        unit: "sessions",
        filters,
      }),
    );
    const sample = screen.getByRole("radio", { name: /A sample of 1,000/ });
    expect(sample).toHaveAttribute("aria-checked", "true");
    expect(
      within(sample).getByText(/Reads 1,000 sessions · about 60 credits/),
    ).toBeInTheDocument();
    // Every row is over the limit for one run.
    expect(screen.getByRole("radio", { name: /All 104,233/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Question 1" }), {
      target: { value: QUESTION },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Ask Jev about a sample of 1,000 sessions",
      }),
    );
    expect(
      screen.getByText("Saving the question and starting Jev…"),
    ).toBeInTheDocument();
    expect(fakes.startAskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        unit: "sessions",
        filters,
        sampleSize: 1000,
        confirm: false,
        questions: [expect.objectContaining({ question: QUESTION })],
      }),
    );

    await act(async () => {
      finishStart({ taskId: "task-1", questions: QUESTIONS });
    });
    const launched = fakes.askRunArgs
      .filter((args) => args.taskId === "task-1")
      .at(-1);
    expect(launched.startedAt).toBe(fakes.askRunArgs[0].startedAt);
    expect(where().params).toEqual({
      run: "task-1",
      unit: "sessions",
      tab: "sessions",
    });
    expect(screen.getByRole("heading", { name: QUESTION })).toBeInTheDocument();
  });

  it("picks a sample size from the keyboard", async () => {
    renderAt(askLink(PROJECT, { unit: "sessions", label: "Past 7D" }));
    await screen.findByText(/104,233 sessions in the Sessions view/);
    const select = screen.getByRole("combobox", { name: /Sample size/ });
    select.focus();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    const option = await screen.findByRole("option", {
      name: "2,000 sessions",
    });
    // Enter on the menu's option must not reach the card's own Enter
    // handler, which would re-choose the old size.
    fireEvent.keyDown(option, { key: "Enter" });
    expect(
      screen.getByRole("radio", { name: /A sample of 2,000/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("restates the credits before reading every row of a big view", async () => {
    fakes.estimate.mockResolvedValue({
      ...ESTIMATE,
      population: 20000,
      choices: [
        ...ESTIMATE.choices.slice(0, 4),
        {
          sample_size: null,
          rows_to_read: 20000,
          seconds_estimate: 4010,
          needs_confirm: true,
          allowed: true,
        },
      ],
    });
    fakes.startAskRun.mockResolvedValue({
      taskId: "task-2",
      questions: QUESTIONS,
    });
    renderAt(askLink(PROJECT, { unit: "sessions", filters: [] }));
    fireEvent.click(await screen.findByRole("radio", { name: /All 20,000/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Question 1" }), {
      target: { value: QUESTION },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Ask Jev about 20,000 sessions" }),
    );
    expect(fakes.startAskRun).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Read 20,000 sessions\? That is about 1,200 credits/),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
    });
    expect(fakes.startAskRun).toHaveBeenCalledWith(
      expect.objectContaining({ sampleSize: null, confirm: true }),
    );
  });

  it("asks about exactly the rows handed over", async () => {
    fakes.estimate.mockResolvedValue(smallEstimate(3));
    fakes.startAskRun.mockResolvedValue({
      taskId: "task-3",
      questions: QUESTIONS,
    });
    renderAt(
      askLink(PROJECT, {
        unit: "sessions",
        label: "Past 7D",
        population: POPULATION,
        filters: [],
      }),
    );
    expect(
      await screen.findByText(/3 selected sessions from Past 7 days/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Question 1" }), {
      target: { value: QUESTION },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Ask Jev about 3 sessions" }),
      );
    });
    expect(fakes.startAskRun).toHaveBeenCalledWith(
      expect.objectContaining({ ids: ["s1", "s2", "s3"], sampleSize: null }),
    );
  });

  it("names the runs in flight when the organization is at its limit", async () => {
    const { AskBusy } = await import("../../useInstantEval");
    fakes.estimate.mockResolvedValue(smallEstimate(3));
    fakes.startAskRun.mockRejectedValue(
      new AskBusy({
        message:
          "Your organization already has 2 Instant eval runs in progress, the most it runs at once: “Was it resolved?” (1,000 rows, started by Ada).",
      }),
    );
    renderAt(askLink(PROJECT, { unit: "sessions", population: POPULATION }));
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Question 1" }),
      { target: { value: QUESTION } },
    );
    await screen.findByText(/3 selected sessions/);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Ask Jev about 3 sessions" }),
      );
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/started by Ada/);
    expect(screen.getByRole("textbox", { name: "Question 1" })).toHaveValue(
      QUESTION,
    );
    expect(where().params.new).toBe("1");
  });

  it("offers the largest sample the credits left this month pay for", async () => {
    fakes.estimate.mockResolvedValue({
      ...ESTIMATE,
      credit_check: {
        allowed: false,
        error_code: "FREE_TIER_LIMIT",
        current_usage: 970,
        limit: 1000,
        credits_left: 30,
        blocked: false,
        message:
          "This run needs about 60 credits; you have 30 left this month.",
      },
      credit_max_sample: 500,
    });
    renderAt(askLink(PROJECT, { unit: "sessions" }));
    await screen.findByRole("radio", { name: /A sample of 1,000/ });
    const needs =
      /This run needs about 60 credits; you have 30 left this month\./;
    expect(screen.getByText(needs)).toBeInTheDocument();
    // Reading every row needs more still; why is said outside the faded,
    // disabled choice.
    const why = screen.getByText(/needs about 6,254 credits; you have 30 left/);
    expect(why.closest("[aria-disabled='true']")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Question 1" }), {
      target: { value: QUESTION },
    });
    expect(
      screen.getByRole("button", {
        name: "Ask Jev about a sample of 1,000 sessions",
      }),
    ).toBeDisabled();
    // The way forward stays usable on the card that can't be chosen.
    const all = screen.getByRole("radio", { name: /All 104,233/ });
    expect(all).toHaveAttribute("aria-disabled", "true");
    const offers = screen.getAllByRole("button", {
      name: "Read a sample of 500 sessions instead",
    });
    expect(offers).toHaveLength(2);
    for (const offer of offers) {
      expect(offer).toBeEnabled();
      expect(offer.closest("[aria-disabled='true']")).toBeNull();
    }
    fireEvent.click(offers[0]);
    const fitted = screen.getByRole("radio", { name: /A sample of 500/ });
    expect(fitted).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(needs)).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Ask Jev about a sample of 500 sessions",
      }),
    ).toBeEnabled();
  });

  it("links to billing outside the card when no sample fits", async () => {
    fakes.estimate.mockResolvedValue({
      ...ESTIMATE,
      credit_check: {
        allowed: false,
        error_code: "FREE_TIER_LIMIT",
        current_usage: 1000,
        limit: 1000,
        credits_left: 0,
        blocked: false,
        message:
          "This run needs about 60 credits; you have none left this month.",
      },
      credit_max_sample: 0,
    });
    renderAt(askLink(PROJECT, { unit: "sessions" }));
    const all = await screen.findByRole("radio", { name: /All 104,233/ });
    expect(all).toHaveAttribute("aria-disabled", "true");
    const links = screen.getAllByRole("link", { name: "Open billing" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/dashboard/settings/billing");
      expect(link.closest("[aria-disabled='true']")).toBeNull();
    }
    expect(
      screen.getAllByText(/you have none left this month\./).length,
    ).toBeGreaterThan(0);
  });

  it("prints a run's credits under 1 to a tenth", () => {
    fakes.askRuns["task-sessions"] = { ...runOf(), creditsUsed: 0.72 };
    renderAt(
      `/dashboard/observe/${PROJECT}/ask?run=task-sessions&unit=sessions&tab=sessions`,
    );
    expect(screen.getByText(/· 0\.7 credits/)).toBeInTheDocument();
    expect(screen.queryByText(/\b1 credits\b/)).toBeNull();
  });

  it("says why billing refused a start and links to billing", async () => {
    const { AskNoCredits } = await import("../../useInstantEval");
    fakes.estimate.mockResolvedValue(smallEstimate(3));
    fakes.startAskRun.mockRejectedValue(
      new AskNoCredits({
        message:
          "Your subscription has unpaid invoices. Update your payment method in billing to run this.",
        error_code: "PAYMENT_REQUIRED",
        credits_estimate: 0.18,
      }),
    );
    renderAt(askLink(PROJECT, { unit: "sessions", population: POPULATION }));
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Question 1" }),
      { target: { value: QUESTION } },
    );
    await screen.findByText(/3 selected sessions/);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Ask Jev about 3 sessions" }),
      );
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/unpaid invoices/);
    expect(
      within(alert).getByRole("link", { name: "Open billing" }),
    ).toHaveAttribute("href", "/dashboard/settings/billing");
  });

  it("opens a past run from History on its own view's tab", () => {
    fakes.runs = [
      historyItem("task-traces", "traces", "Did the user get a refund?"),
      historyItem("task-sessions", "sessions", QUESTION),
    ];
    fakes.askRuns["task-sessions"] = doneRun;
    renderAt(
      `/dashboard/observe/${PROJECT}/ask?run=task-traces&unit=traces&tab=traces`,
    );

    // Narrow windows start with History closed.
    fireEvent.click(
      screen.getByRole("button", { name: "Show past questions" }),
    );
    fireEvent.click(
      screen.getByRole("link", { name: `Open the run: ${QUESTION}` }),
    );
    expect(where().params).toEqual({
      run: "task-sessions",
      unit: "sessions",
      tab: "sessions",
    });
    expect(screen.getByText("3 sessions answered in 21 s")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: `Open the run: ${QUESTION}` }),
    ).toHaveAttribute("aria-current", "page");

    // + New question starts on the same view.
    fireEvent.click(screen.getByRole("button", { name: /New question/ }));
    expect(where().params).toEqual({
      new: "1",
      unit: "sessions",
      tab: "sessions",
    });
  });

  it("puts a run opened by its link alone on its own view's tab", () => {
    fakes.askRuns["task-traces"] = {
      ...doneRun,
      unit: "traces",
      knownUnit: "traces",
    };
    renderAt(`/dashboard/observe/${PROJECT}/ask?run=task-traces`);
    expect(where().params).toEqual({
      run: "task-traces",
      unit: "traces",
      tab: "traces",
    });
  });

  it("opens the latest run when nothing is chosen", () => {
    fakes.runs = [historyItem("task-sessions", "sessions", QUESTION)];
    fakes.askRuns["task-sessions"] = doneRun;
    renderAt(`/dashboard/observe/${PROJECT}/ask?tab=sessions`);
    expect(where().params).toEqual({
      run: "task-sessions",
      unit: "sessions",
      tab: "sessions",
    });
  });

  it("narrows the rows to a focused answer or a selection, and clears", () => {
    fakes.runs = [historyItem("task-sessions", "sessions", QUESTION)];
    fakes.askRuns["task-sessions"] = doneRun;
    renderAt(
      `/dashboard/observe/${PROJECT}/ask?run=task-sessions&unit=sessions&tab=sessions`,
    );
    // A run of a few rows draws a square each; the counts come with it.
    expect(screen.getByText("3 squares")).toBeInTheDocument();
    expect(screen.getByText("3 counted")).toBeInTheDocument();
    const table = () =>
      screen.getByRole("region", { name: "Sessions asked about" });
    const rows = () => within(table()).getAllByRole("row").length - 1;
    expect(rows()).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: "Focus No" }));
    expect(fakes.rowsArgs.at(-1).filter).toEqual({
      config_id: CONFIG,
      answer: "No",
    });
    expect(rows()).toBe(2);
    expect(within(table()).getByText(`No · ${QUESTION}`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select the outage" }));
    expect(fakes.rowsArgs.at(-1).filter).toEqual({
      time_from: "2026-10-13T14:00:00Z",
      time_to: "2026-10-13T16:00:00Z",
    });
    expect(rows()).toBe(2);
    expect(within(table()).getByText("Tue Oct 13, 2–4 PM")).toBeInTheDocument();
    const bar = screen.getByRole("region", { name: "Selected rows" });
    expect(within(bar).getByText(/2 sessions/)).toBeInTheDocument();

    fireEvent.click(within(bar).getByRole("button", { name: "Clear" }));
    expect(rows()).toBe(3);
    expect(screen.queryByRole("region", { name: "Selected rows" })).toBeNull();
  });

  it("estimates the whole view from a sample and reads more of it", async () => {
    const sample = {
      population: 104233,
      population_is_lower_bound: false,
      requested: 1000,
      read: 1000,
      is_sample: true,
      can_extend: true,
      next_size: 1000,
    };
    fakes.askRuns["task-sessions"] = runOf({
      total: 1000,
      answered: 1000,
      sample,
      records: null,
    });
    renderAt(
      `/dashboard/observe/${PROJECT}/ask?run=task-sessions&unit=sessions&tab=sessions`,
    );
    // Too many rows for squares: the charts draw the counts.
    expect(screen.getByText("columns")).toBeInTheDocument();
    expect(screen.getByText("≈ 38% No (95% CI 35–41%)")).toBeInTheDocument();
    expect(
      screen.getByText(/1,000 of 104,233 sessions read/),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Read 1,000 more" }));
    });
    expect(fakes.control).toHaveBeenCalledWith("read_more", { more: 1000 });
  });

  it("explains a read-more refused at the credit cap, with a billing link", async () => {
    const sample = {
      population: 104233,
      population_is_lower_bound: false,
      requested: 1000,
      read: 1000,
      is_sample: true,
      can_extend: true,
      next_size: 1000,
    };
    fakes.askRuns["task-sessions"] = runOf({
      total: 1000,
      answered: 1000,
      sample,
      records: null,
    });
    const message =
      "This run needs about 60 credits; you have 12 left this month. A sample of up to 200 sessions fits.";
    fakes.control.mockRejectedValueOnce({
      response: {
        status: 403,
        data: {
          result: {
            message,
            error_code: "FREE_TIER_LIMIT",
            credits_estimate: 60,
            credits_left: 12,
            sample_size: 200,
          },
        },
      },
    });
    renderAt(
      `/dashboard/observe/${PROJECT}/ask?run=task-sessions&unit=sessions&tab=sessions`,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Read 1,000 more" }));
    });
    expect(screen.getByText(message, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open billing" })).toHaveAttribute(
      "href",
      "/dashboard/settings/billing",
    );
  });

  it("says how far the rows Jev couldn't answer could move a sample's estimate", async () => {
    const sample = {
      population: 24473,
      population_is_lower_bound: false,
      requested: 1000,
      read: 1000,
      is_sample: true,
      can_extend: true,
      next_size: 1000,
    };
    fakes.askRuns["task-sessions"] = runOf({
      total: 1107,
      answered: 1000,
      failed: 107,
      sample,
      records: null,
    });
    renderAt(
      `/dashboard/observe/${PROJECT}/ask?run=task-sessions&unit=sessions&tab=sessions`,
    );
    expect(
      screen.getByText(
        /^107 of 1,107 couldn't be answered\. If they were all Yes or all No, No would be \d+–\d+%\.$/,
      ),
    ).toBeInTheDocument();
    // The retry sits with the bounds, once.
    const retries = screen.getAllByRole("button", { name: "Retry 107 rows" });
    expect(retries).toHaveLength(1);
    await act(async () => {
      fireEvent.click(retries[0]);
    });
    expect(fakes.control).toHaveBeenCalledWith("retry_failed", {});
  });

  it("pauses a live run and retries the rows that failed", async () => {
    fakes.askRuns["task-sessions"] = runOf({
      status: "running",
      total: 3000,
      answered: 1200,
      failed: 30,
      records: null,
    });
    renderAt(
      `/dashboard/observe/${PROJECT}/ask?run=task-sessions&unit=sessions&tab=sessions`,
    );
    expect(
      screen.getByText(
        /Answering 1,230 of 3,000 · 152 \/ min · about 4 min left/,
      ),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    });
    expect(fakes.control).toHaveBeenCalledWith("pause", {});
    // A live run retries its failures once it is done.
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("says a pause is draining, and when a run waits for its workers", () => {
    const pausing = runOf({ status: "pausing", total: 1000, answered: 410 });
    pausing.summary = { ...pausing.summary, in_flight: 6 };
    fakes.askRuns["task-sessions"] = pausing;
    const { unmount } = renderAt(
      `/dashboard/observe/${PROJECT}/ask?run=task-sessions&unit=sessions&tab=sessions`,
    );
    expect(
      screen.getByText(/Pausing… 6 still answering · 410 of 1,000 read/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    unmount();

    const waiting = runOf({ status: "running", total: 1000, answered: 410 });
    waiting.summary = { ...waiting.summary, waiting_s: 185 };
    fakes.askRuns["task-sessions"] = waiting;
    renderAt(
      `/dashboard/observe/${PROJECT}/ask?run=task-sessions&unit=sessions&tab=sessions`,
    );
    expect(
      screen.getByText(
        /Waiting for workers… no answer for 3 min · 410 of 1,000 answered/,
      ),
    ).toBeInTheDocument();
  });

  it("retries the rows that failed once a run is done", async () => {
    fakes.askRuns["task-sessions"] = runOf({
      total: 3000,
      answered: 2970,
      failed: 30,
      records: null,
    });
    renderAt(
      `/dashboard/observe/${PROJECT}/ask?run=task-sessions&unit=sessions&tab=sessions`,
    );
    expect(
      screen.getByText(/30 rows couldn't be fully answered/),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry 30 rows" }));
    });
    expect(fakes.control).toHaveBeenCalledWith("retry_failed", {});
  });
});

describe("a run that stopped before finishing", () => {
  it("says how far it got and resumes", async () => {
    fakes.askRuns["task-sessions"] = runOf({
      status: "stalled",
      total: 3000,
      answered: 1200,
      records: null,
    });
    renderAt(
      `/dashboard/observe/${PROJECT}/ask?run=task-sessions&unit=sessions&tab=sessions`,
    );
    expect(
      screen.getByText(
        "This run stopped before finishing: 1,200 of 3,000 answered",
      ),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    });
    expect(fakes.control).toHaveBeenCalledWith("resume", {});
  });
});

describe("a new question's date and filters", () => {
  const STATUS = {
    column_id: "status",
    filter_config: {
      filter_type: "text",
      filter_op: "equals",
      filter_value: "ERROR",
      col_type: "SYSTEM_METRIC",
    },
  };
  const viewOf = (unit, filters, dateOption = "7D") =>
    viewSeed({
      unit,
      filters: [windowItem(presetWindow(dateOption)), ...filters],
      dateFilter: { dateOption },
    });

  it("edits the view's date and filters in place, recounts and starts with them", async () => {
    fakes.startAskRun.mockResolvedValue({
      taskId: "task-4",
      questions: QUESTIONS,
    });
    renderAt(askLink(PROJECT, viewOf("sessions", [STATUS])));
    await screen.findByText(/104,233 sessions in the Sessions view/);
    // Counted as a start would send it: the filters, preset and label.
    expect(fakes.estimate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        unit: "sessions",
        filters: [STATUS, windowItem(presetWindow("7D"))],
        datePreset: "7D",
        label: "Past 7D · 1 filter",
      }),
    );
    // The view's own date and filters, editable here.
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.queryByText(/Change them in/)).toBeNull();
    expect(
      screen.getByText(
        "Counted with the date range and filters above, started from the Sessions view.",
      ),
    ).toBeInTheDocument();

    fakes.estimate.mockResolvedValue(smallEstimate(40));
    fireEvent.click(screen.getByRole("button", { name: "Past 7D" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Past 30D" }));
    expect(
      await screen.findByText(/40 sessions in the Sessions view/),
    ).toBeInTheDocument();
    const month = [STATUS, windowItem(presetWindow("30D"))];
    expect(fakes.estimate).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: month }),
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Question 1" }), {
      target: { value: QUESTION },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Ask Jev about 40 sessions" }),
      );
    });
    expect(fakes.startAskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: month,
        datePreset: "30D",
        label: "Past 30D · 1 filter",
        sampleSize: null,
      }),
    );
    // The run says what it read.
    expect(screen.getByText(/Past 30 days · 1 filter/)).toBeInTheDocument();
  });

  it("counts users a few seconds at a time, and lets a start go ahead", async () => {
    const counts = [
      { ...smallEstimate(209), population_is_lower_bound: true },
      smallEstimate(371),
    ];
    fakes.estimate.mockImplementation(async () =>
      counts.length > 1 ? counts.shift() : counts[0],
    );
    renderAt(
      askLink(PROJECT, {
        ...viewOf("users", [STATUS]),
        search: "acme",
        label: undefined,
      }),
    );
    expect(
      await screen.findByText(/209\+ users in the Users view/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Still counting the users/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search users" })).toHaveValue(
      "acme",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Question 1" }), {
      target: { value: QUESTION },
    });
    expect(
      screen.getByRole("button", { name: "Ask Jev about 209 sessions" }),
    ).toBeEnabled();
    expect(
      await screen.findByText(
        /371 users in the Users view/,
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(fakes.estimate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        unit: "users",
        search: "acme",
        datePreset: "7D",
        label: "Past 7D · 1 filter · “acme”",
      }),
    );
  });

  it("keeps the date on another unit and says which filters went", async () => {
    renderAt(`/dashboard/observe/${PROJECT}/ask?new=1&unit=traces&tab=traces`);
    await screen.findByText(/104,233 traces in the Traces view/);
    expect(
      screen.getByText("Counted with the date range and filters above."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Past 7D" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Past 30D" }));
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick status ERROR" }));
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(screen.getByText("Status")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
    expect(where().params).toMatchObject({ unit: "sessions" });
    expect(
      await screen.findByText(
        "1 filter doesn't apply to sessions, so it was removed. The date range stays.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Past 30D" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Status")).toBeNull();
    await waitFor(() =>
      expect(fakes.estimate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          unit: "sessions",
          filters: [windowItem(presetWindow("30D"))],
        }),
      ),
    );
  });

  it("remembers the sample size picked after a turn to every row", async () => {
    fakes.estimate.mockResolvedValue({
      ...ESTIMATE,
      population: 20000,
      choices: [
        ...ESTIMATE.choices.slice(0, 4),
        {
          sample_size: null,
          rows_to_read: 20000,
          seconds_estimate: 4010,
          needs_confirm: true,
          allowed: true,
        },
      ],
    });
    renderAt(askLink(PROJECT, { unit: "sessions" }));
    const select = await screen.findByRole("combobox", { name: /Sample size/ });
    fireEvent.mouseDown(select);
    fireEvent.click(
      await screen.findByRole("option", { name: "2,000 sessions" }),
    );
    expect(
      screen.getByRole("radio", { name: /A sample of 2,000/ }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /All 20,000/ }));
    const sample = screen.getByRole("radio", { name: /A sample of 2,000/ });
    expect(sample).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sample);
    expect(
      screen.getByRole("radio", { name: /A sample of 2,000/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("asks about a selection as it is, or the view's filters instead", async () => {
    fakes.estimate.mockResolvedValue(smallEstimate(3));
    renderAt(
      askLink(PROJECT, {
        ...viewOf("sessions", [STATUS]),
        population: POPULATION,
      }),
    );
    await screen.findByText(/3 selected sessions from Past 7 days · 1 filter/);
    expect(screen.queryByRole("button", { name: "Filter" })).toBeNull();
    fakes.estimate.mockResolvedValue(ESTIMATE);
    fireEvent.click(
      screen.getByRole("button", { name: "Use the view's filters instead" }),
    );
    expect(
      await screen.findByText(/104,233 sessions in the Sessions view/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
  });
});

describe("running a question again", () => {
  const STATUS = {
    column_id: "status",
    filter_config: {
      filter_type: "text",
      filter_op: "equals",
      filter_value: "ERROR",
    },
  };
  const OLD = ["2026-09-01T00:00:00.000Z", "2026-09-08T00:00:00.000Z"];
  const runAsked = (scope) => ({
    ...doneRun,
    summary: {
      ...doneRun.summary,
      scope: {
        filters: [STATUS, windowItem(OLD)],
        sample_size: 1000,
        ids: null,
        ...scope,
      },
    },
  });
  const runAgain = async () => {
    renderAt(
      `/dashboard/observe/${PROJECT}/ask?run=task-sessions&unit=sessions&tab=sessions`,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    });
  };

  beforeEach(() => {
    fakes.startAskRun.mockResolvedValue({
      taskId: "task-5",
      questions: QUESTIONS,
    });
  });

  it("moves a preset's window to now", async () => {
    fakes.askRuns["task-sessions"] = runAsked({
      date_preset: "7D",
      label: "Past 7D · 1 filter",
    });
    await runAgain();
    expect(fakes.startAskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [STATUS, windowItem(presetWindow("7D"))],
        datePreset: "7D",
        label: "Past 7D · 1 filter",
        sampleSize: 1000,
        confirm: true,
      }),
    );
  });

  it("reads a custom range again as it was", async () => {
    fakes.askRuns["task-sessions"] = runAsked({
      date_preset: "Custom",
      label: "Custom range · 1 filter",
    });
    renderAt(
      `/dashboard/observe/${PROJECT}/ask?run=task-sessions&unit=sessions&tab=sessions`,
    );
    // The header names a custom range by its dates.
    expect(screen.getByText(/Oct 13 – Oct 14 · 1 filter/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    });
    expect(fakes.startAskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [STATUS, windowItem(OLD)],
        datePreset: "Custom",
        label: "Custom range · 1 filter",
      }),
    );
  });
});

describe("a sample size typed in", () => {
  // The server costs any size as it costs the fixed ones.
  const costed =
    (estimate) =>
    async ({ sampleSize }) =>
      sampleSize
        ? {
            ...estimate,
            rows_to_read: Math.min(sampleSize, estimate.population),
            // Slower than reading every row would suggest, to tell them apart.
            seconds_estimate: 10 + sampleSize,
            needs_confirm: sampleSize > estimate.confirm_rows,
          }
        : estimate;
  const sizesAsked = () =>
    fakes.estimate.mock.calls
      .map(([args]) => args.sampleSize)
      .filter((size) => size != null);
  const pickCustom = async () => {
    const select = await screen.findByRole("combobox", { name: /Sample size/ });
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByRole("option", { name: "Custom…" }));
    return screen.getByRole("spinbutton", { name: "Custom sample size" });
  };
  const ask = () =>
    fireEvent.change(screen.getByRole("textbox", { name: "Question 1" }), {
      target: { value: QUESTION },
    });

  it("costs a typed size on the server and starts with it", async () => {
    fakes.estimate.mockImplementation(costed(ESTIMATE));
    fakes.startAskRun.mockResolvedValue({
      taskId: "task-6",
      questions: QUESTIONS,
    });
    renderAt(askLink(PROJECT, { unit: "sessions" }));
    await screen.findByText(/104,233 sessions in the Sessions view/);
    const box = await pickCustom();
    // It starts from the size that was shown.
    expect(box).toHaveValue(1000);
    fireEvent.change(box, { target: { value: "1500" } });
    const card = screen.getByRole("radio", { name: /A sample of/ });
    expect(card).toHaveAttribute("aria-checked", "true");
    // Costed by the server once the typing settles.
    expect(
      await within(card).findByText(
        /Reads 1,500 sessions · about 90 credits · about 25 min/,
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(sizesAsked()).toEqual([1500]);
    ask();
    const start = await screen.findByRole("button", {
      name: "Ask Jev about a sample of 1,500 sessions",
    });
    await waitFor(() => expect(start).toBeEnabled(), { timeout: 4000 });
    await act(async () => {
      fireEvent.click(start);
    });
    expect(fakes.startAskRun).toHaveBeenCalledWith(
      expect.objectContaining({ sampleSize: 1500, confirm: false }),
    );
  });

  it("says plainly why a size can't be read", async () => {
    const big = { ...ESTIMATE, population: 150000 };
    fakes.estimate.mockImplementation(costed(big));
    renderAt(askLink(PROJECT, { unit: "sessions" }));
    await screen.findByText(/150,000 sessions in the Sessions view/);
    const box = await pickCustom();
    ask();
    for (const [typed, why] of [
      ["0", "Choose a sample of at least 1."],
      ["120000", "One run reads at most 100,000 rows; choose up to 100,000."],
    ]) {
      fireEvent.change(box, { target: { value: typed } });
      expect(screen.getByText(why)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ask Jev" })).toBeDisabled();
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    // None of them is costed.
    expect(sizesAsked()).toEqual([]);
    // The largest that can run is one click away.
    fireEvent.click(screen.getByRole("button", { name: "Use 100,000" }));
    expect(box).toHaveValue(100000);
  });

  it("offers the most a smaller view holds", async () => {
    const small = { ...ESTIMATE, population: 3744 };
    fakes.estimate.mockImplementation(costed(small));
    renderAt(askLink(PROJECT, { unit: "sessions" }));
    await screen.findByText(/3,744 sessions in the Sessions view/);
    const box = await pickCustom();
    fireEvent.change(box, { target: { value: "9000" } });
    expect(
      screen.getByText(
        "There are only 3,744 sessions in this view; choose up to 3,744.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use 3,744" }));
    expect(box).toHaveValue(3744);
  });

  it("says inline why a start was refused for its size", async () => {
    const { AskSampleTooLarge } = await import("../../useInstantEval");
    fakes.estimate.mockImplementation(costed(ESTIMATE));
    fakes.startAskRun.mockRejectedValue(
      new AskSampleTooLarge({
        message:
          "There are only 1,400 sessions in this view; choose up to 1,400.",
        sample_size: 1400,
      }),
    );
    renderAt(askLink(PROJECT, { unit: "sessions" }));
    await screen.findByText(/104,233 sessions in the Sessions view/);
    fireEvent.change(await pickCustom(), { target: { value: "1500" } });
    ask();
    const start = await screen.findByRole("button", {
      name: "Ask Jev about a sample of 1,500 sessions",
    });
    await waitFor(() => expect(start).toBeEnabled(), { timeout: 4000 });
    await act(async () => {
      fireEvent.click(start);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "There are only 1,400 sessions in this view; choose up to 1,400.",
    );
  });

  it("turns a size the view no longer holds into every row, and says so", async () => {
    fakes.estimate.mockImplementation(costed(ESTIMATE));
    renderAt(askLink(PROJECT, { unit: "sessions" }));
    await screen.findByText(/104,233 sessions in the Sessions view/);
    fireEvent.change(await pickCustom(), { target: { value: "1500" } });
    // The view shrinks below the sample: a filter, a shorter date.
    fakes.estimate.mockImplementation(costed(smallEstimate(400)));
    fireEvent.click(screen.getByRole("button", { name: "Past 7D" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Today" }));
    expect(
      await screen.findByText(
        "This view now holds 400 sessions, fewer than the sample of 1,500, so Jev reads every one.",
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Every one of the 400/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("shows the server's reason when it refuses a size it costed", async () => {
    fakes.estimate.mockImplementation(async ({ sampleSize }) =>
      sampleSize
        ? {
            ...ESTIMATE,
            population: 1200,
            sample_error: {
              error_code: "INSTANT_EVAL_SAMPLE_TOO_LARGE",
              message:
                "There are only 1,200 sessions in this view; choose up to 1,200.",
              sample_size: 1200,
            },
          }
        : ESTIMATE,
    );
    renderAt(askLink(PROJECT, { unit: "sessions" }));
    await screen.findByText(/104,233 sessions in the Sessions view/);
    fireEvent.change(await pickCustom(), { target: { value: "1500" } });
    expect(
      await screen.findByText(
        "There are only 1,200 sessions in this view; choose up to 1,200.",
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    ask();
    expect(screen.getByRole("button", { name: "Ask Jev" })).toBeDisabled();
  });

  it("waits for the typing to settle before costing it", async () => {
    fakes.estimate.mockImplementation(costed(ESTIMATE));
    renderAt(askLink(PROJECT, { unit: "sessions" }));
    await screen.findByText(/104,233 sessions in the Sessions view/);
    const box = await pickCustom();
    for (const typed of ["1", "12", "120", "1200"])
      fireEvent.change(box, { target: { value: typed } });
    await waitFor(() => expect(sizesAsked()).toEqual([1200]), {
      timeout: 4000,
    });
  });

  it("costs a typed size from every row when the server can't", async () => {
    fakes.estimate.mockImplementation(async ({ sampleSize }) => {
      if (sampleSize) throw new Error("unavailable");
      return ESTIMATE;
    });
    renderAt(askLink(PROJECT, { unit: "sessions" }));
    await screen.findByText(/104,233 sessions in the Sessions view/);
    fireEvent.change(await pickCustom(), { target: { value: "1500" } });
    ask();
    const start = await screen.findByRole("button", {
      name: "Ask Jev about a sample of 1,500 sessions",
    });
    await waitFor(() => expect(start).toBeEnabled(), { timeout: 4000 });
    expect(
      within(screen.getByRole("radio", { name: /A sample of/ })).getByText(
        /Reads 1,500 sessions/,
      ),
    ).toBeInTheDocument();
  });

  it("restates the credits for a typed size past the confirm limit", async () => {
    fakes.estimate.mockImplementation(costed(ESTIMATE));
    fakes.startAskRun.mockResolvedValue({
      taskId: "task-7",
      questions: QUESTIONS,
    });
    renderAt(askLink(PROJECT, { unit: "sessions" }));
    await screen.findByText(/104,233 sessions in the Sessions view/);
    fireEvent.change(await pickCustom(), { target: { value: "6000" } });
    ask();
    const start = await screen.findByRole("button", {
      name: "Ask Jev about a sample of 6,000 sessions",
    });
    await waitFor(() => expect(start).toBeEnabled(), { timeout: 4000 });
    fireEvent.click(start);
    expect(fakes.startAskRun).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Read 6,000 sessions\? That is about 360 credits/),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
    });
    expect(fakes.startAskRun).toHaveBeenCalledWith(
      expect.objectContaining({ sampleSize: 6000, confirm: true }),
    );
  });

  it("remembers a typed size after a turn to every row", async () => {
    const view = {
      ...ESTIMATE,
      population: 20000,
      choices: [
        ...ESTIMATE.choices.slice(0, 4),
        {
          sample_size: null,
          rows_to_read: 20000,
          seconds_estimate: 4010,
          needs_confirm: true,
          allowed: true,
        },
      ],
    };
    fakes.estimate.mockImplementation(costed(view));
    renderAt(askLink(PROJECT, { unit: "sessions" }));
    fireEvent.change(await pickCustom(), { target: { value: "1500" } });
    fireEvent.click(screen.getByRole("radio", { name: /All 20,000/ }));
    const sample = screen.getByRole("radio", { name: /A sample of/ });
    expect(sample).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("spinbutton", { name: "Custom sample size" }),
    ).toHaveValue(1500);
    fireEvent.click(sample);
    expect(sample).toHaveAttribute("aria-checked", "true");
    expect(
      await within(sample).findByText(/Reads 1,500 sessions/),
    ).toBeInTheDocument();
  });

  describe("on a view too small for the fixed sizes", () => {
    it("reads every row by default, or a sample typed in", async () => {
      fakes.estimate.mockImplementation(costed(smallEstimate(108)));
      fakes.startAskRun.mockResolvedValue({
        taskId: "task-8",
        questions: QUESTIONS,
      });
      renderAt(askLink(PROJECT, { unit: "sessions" }));
      const all = await screen.findByRole("radio", {
        name: /Every one of the 108/,
      });
      expect(all).toHaveAttribute("aria-checked", "true");
      expect(
        screen.queryByRole("combobox", { name: /Sample size/ }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Read a sample instead" }),
      );
      const box = screen.getByRole("spinbutton", {
        name: "Custom sample size",
      });
      fireEvent.change(box, { target: { value: "20" } });
      expect(all).toHaveAttribute("aria-checked", "false");
      expect(
        await screen.findByText(
          /Reads 20 sessions · about 1\.2 credits · about 30 s/,
          {},
          { timeout: 4000 },
        ),
      ).toBeInTheDocument();
      expect(sizesAsked()).toEqual([20]);
      ask();
      const start = await screen.findByRole("button", {
        name: "Ask Jev about a sample of 20 sessions",
      });
      await waitFor(() => expect(start).toBeEnabled(), { timeout: 4000 });
      await act(async () => {
        fireEvent.click(start);
      });
      expect(fakes.startAskRun).toHaveBeenCalledWith(
        expect.objectContaining({ sampleSize: 20, confirm: false }),
      );
    });

    it("reads every row for a sample as big as the view", async () => {
      fakes.estimate.mockImplementation(costed(smallEstimate(108)));
      fakes.startAskRun.mockResolvedValue({
        taskId: "task-9",
        questions: QUESTIONS,
      });
      renderAt(askLink(PROJECT, { unit: "sessions" }));
      await screen.findByRole("radio", { name: /Every one of the 108/ });
      fireEvent.click(
        screen.getByRole("button", { name: "Read a sample instead" }),
      );
      const box = screen.getByRole("spinbutton", {
        name: "Custom sample size",
      });
      for (const typed of ["108", "500"]) {
        fireEvent.change(box, { target: { value: typed } });
        expect(
          screen.getByText(
            "That is every one of the 108, so Jev reads every one.",
          ),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("radio", { name: /Every one of the 108/ }),
        ).toHaveAttribute("aria-checked", "true");
      }
      ask();
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Ask Jev about 108 sessions" }),
        );
      });
      expect(fakes.startAskRun).toHaveBeenCalledWith(
        expect.objectContaining({ sampleSize: null }),
      );
    });
  });
});
