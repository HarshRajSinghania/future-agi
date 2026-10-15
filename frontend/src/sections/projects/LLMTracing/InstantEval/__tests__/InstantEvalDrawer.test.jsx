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
  useInstantEvalRun: () => ({
    run: harness.run,
    start: harness.start,
    rerun: harness.rerun,
    view: harness.view,
    reset: harness.reset,
  }),
  useInstantEvals: () => ({ all: [], items: [], refetch: vi.fn() }),
  useInstantEvalHistory: () => ({ runs: [], refetch: vi.fn() }),
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
    expect(screen.getByDisplayValue("The whole conversation")).toBeVisible();

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
      scope: {
        filters: [STATUS_ITEM, DATE_ITEM],
        label: "Past 7D · 1 filter",
        handedOver: null,
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
    expect(screen.getByText("6 sessions answered in 12s")).toBeInTheDocument();
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
      screen.getByRole("button", { name: "Find patterns in these 2 “No” users" }),
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
