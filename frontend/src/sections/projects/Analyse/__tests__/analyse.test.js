import { describe, expect, it, vi } from "vitest";

vi.mock("src/utils/axios", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  readQuery: vi.fn(),
  endpoints: { project: {}, develop: { eval: {} } },
}));

import {
  dateItem,
  presetScope,
  readScope,
  traceViewLink,
} from "../analyseScope";
import { buildHeatmap } from "../AnswerHeatmap";

const STATUS = {
  column_id: "status",
  filter_config: {
    filter_type: "text",
    filter_op: "equals",
    filter_value: "OK",
  },
};

describe("readScope", () => {
  it("takes the Trace view's filters from the URL", () => {
    const filters = [STATUS];
    const search = `?scope=${encodeURIComponent(
      JSON.stringify({ filters, label: "Past 3 days" }),
    )}`;
    expect(readScope(search)).toEqual({
      filters,
      label: "Past 3 days",
      preset: "trace",
    });
  });

  it("falls back to the past seven days for a missing or broken link", () => {
    expect(readScope("").preset).toBe("7d");
    expect(readScope("?scope=%7Bnot-json").preset).toBe("7d");
  });

  it("keeps other filters when switching presets", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const scope = presetScope("24h", [STATUS], now);
    expect(scope.filters[0]).toBe(STATUS);
    expect(scope.filters[1].filter_config.filter_value).toEqual([
      "2026-10-13T12:00:00.000Z",
      "2026-10-14T12:00:00.000Z",
    ]);
  });
});

describe("traceViewLink", () => {
  it("turns the window into the date filter and the answer into a chip", () => {
    const link = traceViewLink({
      projectId: "p1",
      scopeFilters: [
        STATUS,
        dateItem("2026-10-08T00:00:00Z", "2026-10-15T00:00:00Z"),
      ],
      item: { configId: "c1", question: "Refund promised?" },
      labels: ["Yes"],
    });
    const url = new URL(link, "http://x");
    expect(url.pathname).toBe("/dashboard/observe/p1/llm-tracing");
    expect(
      JSON.parse(url.searchParams.get("primaryTraceDateFilter")).dateOption,
    ).toBe("Custom");
    const rows = JSON.parse(url.searchParams.get("observeLinkFilter"));
    expect(rows.map((row) => row.column_id)).toEqual(["status", "c1"]);
    expect(rows[1].filter_config.filter_value).toEqual(["Yes"]);
  });
});

describe("buildHeatmap", () => {
  const at = (day, hour) => new Date(2026, 9, day, hour, 30).toISOString();
  const traces = [
    { traceId: "a", time: at(13, 9), answers: { q: "Yes" } },
    { traceId: "b", time: at(13, 9), answers: { q: "No" } },
    { traceId: "c", time: at(13, 9), answers: { q: "__error__" } },
    { traceId: "d", time: at(15, 22), answers: { q: "Yes" } },
  ];

  it("shows every day of a short window, including quiet ones", () => {
    const rows = buildHeatmap({
      traces,
      configId: "q",
      label: "Yes",
      window: [at(13, 0), at(15, 23)],
    });
    expect(rows).toHaveLength(3);
    expect(rows[1].cells.every((cell) => cell === null)).toBe(true);
  });

  it("counts matches against answered traces, not errors", () => {
    const [first] = buildHeatmap({ traces, configId: "q", label: "Yes" });
    expect(first.cells[9]).toMatchObject({
      total: 3,
      matches: 1,
      answered: 2,
      traceIds: ["a"],
    });
  });

  it("falls back to days that have traces when there is no window", () => {
    const rows = buildHeatmap({ traces, configId: "q", label: "Yes" });
    expect(rows.map((row) => row.date.getDate())).toEqual([13, 15]);
  });
});

describe("heatmap cell bounds", () => {
  it("records the first and last trace time of each cell", () => {
    const traces = [
      {
        traceId: "a",
        time: new Date(2026, 9, 13, 9, 10).toISOString(),
        answers: { q: "Yes" },
      },
      {
        traceId: "b",
        time: new Date(2026, 9, 13, 9, 50).toISOString(),
        answers: { q: "Yes" },
      },
    ];
    const cell = buildHeatmap({ traces, configId: "q", label: "Yes" })
      .flatMap((row) => row.cells)
      .find(Boolean);
    expect(cell.first).toBe(Date.parse(traces[0].time));
    expect(cell.last).toBe(Date.parse(traces[1].time));
  });
});
