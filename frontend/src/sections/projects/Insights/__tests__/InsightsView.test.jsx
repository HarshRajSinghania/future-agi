import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { palette } from "src/theme/palette";
import { typography } from "src/theme/typography";
import configsFixture from "./fixtures/configs.json";
import runFixture from "./fixtures/run_sessions_failures.json";
import unitsFixture from "./fixtures/run_sessions_failures_units.json";

const mocks = vi.hoisted(() => ({
  readQuery: vi.fn(),
  post: vi.fn(),
  collect: vi.fn(),
}));

vi.mock("src/components/iconify", () => ({ default: () => null }));

vi.mock("src/utils/axios", () => ({
  default: {
    get: vi.fn(),
    post: (...args) => mocks.post(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  readQuery: (...args) => mocks.readQuery(...args),
  endpoints: {
    project: {
      insightsConfigs: () => "/tracer/insights/configs/",
      insightsConfig: (id) => `/tracer/insights/configs/${id}/`,
      insightsDraft: () => "/tracer/insights/draft/",
      insightsPreview: () => "/tracer/insights/preview/",
      insightsRuns: () => "/tracer/insights/runs/",
      insightsRun: (id) => `/tracer/insights/runs/${id}/`,
      insightsRunUnits: (id) => `/tracer/insights/runs/${id}/units/`,
    },
  },
}));

vi.mock("src/sections/projects/observePopulation", async (importOriginal) => ({
  ...(await importOriginal()),
  collectPopulation: (...args) => mocks.collect(...args),
}));

import InsightsView from "../InsightsView";

const PROJECT = "1b9823aa-866c-400e-b60e-d99ae498d72a";
const sessionsConfig = configsFixture.result.configs[1];
const CONFIG_ID = sessionsConfig.id;
const RUN_ID = runFixture.result.id;
const configDetail = { ...sessionsConfig, runs: [sessionsConfig.latest_run] };

const ok = (result) => Promise.resolve({ data: { status: true, result } });

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

function renderAt(search) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const theme = createTheme({ palette: palette("light"), typography });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={theme}>
        <MemoryRouter
          initialEntries={[`/dashboard/observe/${PROJECT}/insights${search}`]}
        >
          <Routes>
            <Route
              path="/dashboard/observe/:observeId/insights"
              element={
                <>
                  <InsightsView />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const population = Array.from({ length: 108 }, (_, i) => ({
  id: `s${i}`,
  time: "2026-10-10T00:00:00Z",
  user_id: `u${i % 39}`,
}));

beforeEach(() => {
  mocks.readQuery.mockImplementation((url, { params } = {}) => {
    if (url === "/tracer/insights/configs/") return ok(configsFixture.result);
    if (url === `/tracer/insights/configs/${CONFIG_ID}/`)
      return ok(configDetail);
    if (url === `/tracer/insights/runs/${RUN_ID}/`) return ok(runFixture.result);
    if (url === `/tracer/insights/runs/${RUN_ID}/units/`) {
      const units = unitsFixture.result.units;
      if (params?.unit_ids)
        return ok({
          units: [{ ...units[0], unit_id: params.unit_ids }],
          total: 1,
        });
      return ok(unitsFixture.result);
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  mocks.collect.mockImplementation(({ limit }) =>
    Promise.resolve({
      items: population.slice(0, limit),
      total: 108,
      totalIsLowerBound: false,
      truncated: false,
    }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("InsightsView", () => {
  it("lists saved reports with their distribution, and the templates", async () => {
    renderAt("");
    expect(
      await screen.findByText("sessions/failures test"),
    ).toBeInTheDocument();
    expect(screen.getByText("users/personas test")).toBeInTheDocument();
    expect(
      screen.getAllByText("Shoppers, Account Holders, and Escalators").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Start from a template")).toBeInTheDocument();
    expect(screen.getByText("Who are our users?")).toBeInTheDocument();
  });

  it("renders a completed report: summary, stats, categories and highlights", async () => {
    renderAt(`?report=${CONFIG_ID}`);
    expect(
      await screen.findByRole("heading", {
        name: "Where does the agent fall short?",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Where does Harbor fall short?"),
    ).toBeInTheDocument();
    // Citations are chips, not "#3" in the prose.
    expect(
      screen.getAllByRole("button", { name: "Open example 3" }).length,
    ).toBeGreaterThan(0);
    // 72 of the 106 read had a failure (2 could not be read).
    expect(screen.getByText("Had a failure")).toBeInTheDocument();
    expect(screen.getByText("68%")).toBeInTheDocument();
    expect(
      screen.getByText(/34 left out \(no agent failure found\)/),
    ).toBeInTheDocument();
    // Categories table with a notable difference in plain words.
    const table = screen.getByRole("table");
    expect(
      within(table).getByText("Unverified Claims and Fabricated Facts"),
    ).toBeInTheDocument();
    expect(
      within(table).getAllByText("Sentiment 4.0 vs 2.0").length,
    ).toBeGreaterThan(0);
    // Highlights with their reason.
    expect(screen.getByText("Highlights")).toBeInTheDocument();
    expect(
      screen.getByText(/Refund of \$129 issued outside the 30-day window/),
    ).toBeInTheDocument();
  });

  it("expands a category into its subcategories", async () => {
    renderAt(`?report=${CONFIG_ID}`);
    const toggle = await screen.findByRole("button", {
      name: "Show subcategories of Unresponsive Support and No Escalation",
    });
    const table = screen.getByRole("table");
    expect(
      within(table).queryByText("Ignored Explicit Requests for Human Agent"),
    ).toBeNull();
    fireEvent.click(toggle);
    expect(
      within(table).getByText("Ignored Explicit Requests for Human Agent"),
    ).toBeInTheDocument();
  });

  it("opens the cited example from a citation chip", async () => {
    renderAt(`?report=${CONFIG_ID}`);
    const [chip] = await screen.findAllByRole("button", {
      name: "Open example 11",
    });
    fireEvent.click(chip);
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toContain(
        "example=abf42ede-1742-5a77-acf0-6023fe8c2d61",
      ),
    );
    expect(mocks.readQuery).toHaveBeenCalledWith(
      `/tracer/insights/runs/${RUN_ID}/units/`,
      expect.objectContaining({
        params: expect.objectContaining({
          unit_ids: "abf42ede-1742-5a77-acf0-6023fe8c2d61",
        }),
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Open session's traces" }),
    ).toBeInTheDocument();
  });

  it("opens a category drawer with its examples", async () => {
    renderAt(`?report=${CONFIG_ID}`);
    const table = await screen.findByRole("table");
    fireEvent.click(
      within(table).getByText("Unverified Claims and Fabricated Facts"),
    );
    expect(
      await screen.findByRole("button", { name: "Measure with Jev" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/What is the Coastline Rain Shell made of/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).toContain(
      "category=a55e9078defc",
    );
  });

  it("guides a new report and starts it with the collected population", async () => {
    mocks.post.mockResolvedValue({
      data: { status: true, result: { run_id: RUN_ID, config_id: CONFIG_ID } },
    });
    renderAt("?new=1&lens=failures");
    expect(
      await screen.findByRole("radio", { name: /Failures/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText(/Question/)).toHaveValue(
      "Where is the agent failing?",
    );
    expect(
      (await screen.findAllByText(/Analysing all 108 sessions/)).length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const [url, body] = mocks.post.mock.calls[0];
    expect(url).toBe("/tracer/insights/runs/");
    expect(body.config).toMatchObject({
      unit: "sessions",
      lens: "failures",
      question: "Where is the agent failing?",
      sample_size: 300,
    });
    expect(body.scope.preset).toBe("7d");
    expect(body.scope.window).toHaveLength(2);
    expect(body.population).toHaveLength(108);
    expect(mocks.collect).toHaveBeenCalledWith(
      expect.objectContaining({ unit: "sessions", limit: 2000 }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        `?report=${CONFIG_ID}&run=${RUN_ID}`,
      ),
    );
  });

  it("runs a handed-over population as a fixed scope", async () => {
    mocks.post.mockResolvedValue({
      data: { status: true, result: { run_id: RUN_ID, config_id: CONFIG_ID } },
    });
    const key = "seedkey1";
    sessionStorage.setItem(
      `observe-handoff:${key}`,
      JSON.stringify({
        unit: "sessions",
        population: population.slice(0, 12),
        question: "Why did these sessions get “No”?",
        label: "“No” answers · Was it resolved?",
        source: "Instant eval: Was it resolved?",
      }),
    );
    renderAt(`?new=1&seed=${key}`);
    expect(
      await screen.findByRole("radio", { name: /Your question/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("12 sessions")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const body = mocks.post.mock.calls[0][1];
    expect(body.scope).toEqual({
      label: "“No” answers · Was it resolved?",
      preset: "fixed",
    });
    expect(body.population).toHaveLength(12);
    expect(mocks.collect).not.toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2000 }),
    );
  });
});
