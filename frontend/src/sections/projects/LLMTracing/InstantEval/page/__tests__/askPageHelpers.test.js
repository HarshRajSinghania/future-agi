import { describe, expect, it } from "vitest";
import { askLink, readHandoff } from "src/sections/projects/observeHandoff";
import { OBSERVE_LINK_FILTER_PARAM } from "src/sections/projects/LLMTracing/common";
import {
  displayQuestions,
  runStatus,
  summaryQuestions,
  summaryWindow,
  toRecord,
} from "../useAskRun";
import { rowsGridLink, sourceViewLink, tabForUnit } from "../askLinks";
import {
  dayGroup,
  facetLine,
  formatElapsed,
  runTime,
  scopeWords,
} from "../askFormat";
import {
  choiceCost,
  defaultChoice,
  handedIds,
  sampleSizes,
} from "../askPopulation";
import {
  describeFilter,
  durationWords,
  estimateWords,
  filterParams,
  mergeFilters,
  sampleEstimate,
  wilson,
  answeredSplit,
  boundWords,
  unansweredBounds,
  UNANSWERED_BOUND_SHARE,
} from "../askFilter";
import { lastWeekScope } from "../askScope";

const C1 = "config-1";
const C2 = "config-2";

const row = (id, time, answers = {}, extra = {}) => ({
  id,
  time,
  user_id: `user-${id}`,
  label: `Session ${id}`,
  excerpt: `Where is order ${id}?`,
  answers,
  ...extra,
});

const record = (id, time, answers = {}) =>
  toRecord(row(id, time, answers), "sessions");

describe("an answers row as a record", () => {
  it("keeps the facets and each answer, in-flight answers marked", () => {
    const r = toRecord(
      row(
        "s1",
        "2026-10-13T14:10:00Z",
        {
          [C1]: {
            answer: "No",
            confidence: 0.9,
            explanation: " Never fixed. ",
          },
          [C2]: { answer: null, status: "running" },
        },
        {
          facets: {
            model: "gpt-4o-mini",
            turns: 1,
            duration_ms: 2100,
            error: true,
          },
        },
      ),
      "sessions",
    );
    expect(r).toMatchObject({
      id: "s1",
      unit: "sessions",
      user_id: "user-s1",
      excerpt: "Where is order s1?",
      facets: {
        model: "gpt-4o-mini",
        turns: 1,
        duration_ms: 2100,
        error: true,
      },
    });
    expect(r.answers[C1]).toEqual({
      answer: "No",
      confidence: 0.9,
      explanation: "Never fixed.",
      status: "completed",
    });
    expect(r.answers[C2]).toMatchObject({ answer: null, status: "running" });
    // No facets from an older backend: every facet is unknown, not zero.
    expect(record("s2", null).facets).toEqual({
      model: null,
      turns: null,
      duration_ms: null,
      error: null,
    });
  });
});

describe("a run read from its summary", () => {
  it("says where the run is", () => {
    expect(runStatus(null)).toBe("loading");
    expect(runStatus({ status: "pending", preparing: true })).toBe("preparing");
    expect(runStatus({ status: "running", preparing: false })).toBe("running");
    expect(runStatus({ status: "paused" })).toBe("paused");
    expect(runStatus({ status: "cancelled" })).toBe("cancelled");
    expect(runStatus({ status: "completed" })).toBe("done");
    expect(runStatus({ status: "failed" })).toBe("done");
    expect(runStatus({ status: "stalled" })).toBe("stalled");
  });

  it("takes its questions from the summary and the saved evaluators", () => {
    const summary = {
      questions: [
        {
          config_id: C1,
          question: "Was it resolved?",
          answer_type: "yes_no",
          labels: ["Yes", "No"],
        },
      ],
    };
    expect(
      summaryQuestions(summary, {
        [C1]: { reads: "transcript", templateId: "t1", definitions: {} },
      }),
    ).toEqual([
      {
        configId: C1,
        question: "Was it resolved?",
        answerType: "yes_no",
        labels: ["Yes", "No"],
        definitions: {},
        reads: "transcript",
        templateId: "t1",
        fullQuestion: "Was it resolved?",
      },
    ]);
  });

  it("shows questions without the prefix every one of them shares", () => {
    expect(
      displayQuestions([
        "Synthetic scale test · What did the customer come for?",
        "Synthetic scale test · Did the agent resolve the customer's issue?",
      ]),
    ).toEqual([
      "What did the customer come for?",
      "Did the agent resolve the customer's issue?",
    ]);
    expect(displayQuestions(["Instant eval · Was it resolved?"])).toEqual([
      "Was it resolved?",
    ]);
    expect(displayQuestions(["Tone · polite?", "Was it resolved?"])).toEqual([
      "Tone · polite?",
      "Was it resolved?",
    ]);
    expect(formatElapsed(21000)).toBe("21 s");
    expect(formatElapsed(35 * 60000 + 3000)).toBe("35 min");
    expect(formatElapsed(125 * 60000)).toBe("2 h 5 min");
  });

  it("draws the timeline's window", () => {
    expect(summaryWindow({ timeline: { from: 0, to: 3600000 } })).toEqual([
      "1970-01-01T00:00:00.000Z",
      "1970-01-01T01:00:00.000Z",
    ]);
    expect(summaryWindow({ timeline: {} })).toBeNull();
  });
});

describe("what the charts select, as a filter", () => {
  it("turns a selection into the rows endpoint's parameters", () => {
    expect(
      filterParams({
        time_from: 1792000000000,
        time_to: "2026-10-13T17:00:00Z",
        config_id: C1,
        answer: "No",
        group: ["weekday:6", "weekday:7"],
      }),
    ).toEqual({
      time_from: new Date(1792000000000).toISOString(),
      time_to: "2026-10-13T17:00:00.000Z",
      config_id: C1,
      answer: "No",
      group: "weekday:6,weekday:7",
    });
    expect(
      filterParams({
        answers: [{ config_id: C1, answer: "No" }],
        unsure: true,
      }),
    ).toEqual({
      answers: JSON.stringify([{ config_id: C1, answer: "No" }]),
      unsure: true,
    });
    expect(filterParams(null)).toEqual({});
  });

  it("combines a focused answer with a selection", () => {
    expect(
      mergeFilters(
        { config_id: C1, answer: "No" },
        { config_id: C2, answer: "Order status", time_from: "x" },
      ),
    ).toEqual({
      time_from: "x",
      answers: [
        { config_id: C1, answer: "No" },
        { config_id: C2, answer: "Order status" },
      ],
    });
  });

  it("names a filter the charts didn't label", () => {
    const questions = [{ configId: C1 }, { configId: C2 }];
    expect(describeFilter({ config_id: C2, answer: "No" }, questions)).toBe(
      "“No” (Q2)",
    );
    expect(describeFilter({ group: "model:gpt-4.1-mini" }, [])).toBe(
      "model gpt-4.1-mini",
    );
  });
});

describe("a sample's estimate for the whole view", () => {
  it("is a Wilson interval narrowed by the share of the view read", () => {
    const open = wilson(380, 1000, 104233);
    expect(open.p).toBeCloseTo(0.38);
    expect(open.lo).toBeCloseTo(0.35, 2);
    expect(open.hi).toBeCloseTo(0.41, 2);
    const most = wilson(380, 1000, 1100);
    expect(most.hi - most.lo).toBeLessThan((open.hi - open.lo) / 2);
    expect(wilson(380, 1000, 1000)).toEqual({ p: 0.38, lo: 0.38, hi: 0.38 });
    expect(estimateWords("No", open)).toBe("≈ 38% No (95% CI 35–41%)");
  });

  it("estimates the problem answer, or the one in focus", () => {
    const run = {
      sample: { is_sample: true, population: 104233 },
      summary: { counts: { [C1]: { Yes: 620, No: 380, __error__: 12 } } },
    };
    const question = { configId: C1, answerType: "yes_no" };
    expect(sampleEstimate(run, question, null).words).toBe(
      "≈ 38% No (95% CI 35–41%)",
    );
    expect(sampleEstimate(run, question, "Yes").label).toBe("Yes");
    expect(
      sampleEstimate({ ...run, sample: { is_sample: false } }, question),
    ).toBeNull();
  });

  it("gives a category question's three most common answers", () => {
    const run = {
      sample: { is_sample: true, population: 100000 },
      summary: {
        counts: {
          [C1]: {
            "Order status": 7624,
            "Return or refund": 6362,
            "Product advice": 3862,
            "Something else": 3803,
            __error__: 135,
          },
        },
      },
    };
    const question = { configId: C1, answerType: "category" };
    const estimate = sampleEstimate(run, question, null);
    expect(estimate.label).toBe("Order status");
    expect(estimate.parts).toHaveLength(3);
    expect(estimate.parts[0]).toMatch(/^≈ 35% Order status \(35–36%\)$/);
    expect(estimate.parts[1]).toMatch(/^29% Return or refund \(\d+–\d+%\)$/);
    expect(estimate.parts[2]).toMatch(/^18% Product advice/);
    // One answer in focus: just that one, with its interval.
    expect(sampleEstimate(run, question, "Something else").parts).toEqual([
      expect.stringMatching(/^≈ 18% Something else \(95% CI/),
    ]);
  });
});

describe("how much of a view to read", () => {
  const estimate = {
    population: 104233,
    confirm_rows: 5000,
    max_rows: 100000,
    default_sample_size: 1000,
    choices: [
      { sample_size: 500, rows_to_read: 500, seconds_estimate: 110 },
      { sample_size: 1000, rows_to_read: 1000, seconds_estimate: 210 },
      { sample_size: null, rows_to_read: 104233, seconds_estimate: 20857 },
    ],
  };

  it("offers a sample by default above 1,000 rows", () => {
    expect(sampleSizes(estimate)).toEqual([500, 1000]);
    expect(defaultChoice(estimate)).toBe(1000);
    expect(defaultChoice({ ...estimate, default_sample_size: null })).toBe(
      null,
    );
  });

  it("costs each choice for the questions asked", () => {
    expect(choiceCost(estimate, 1000, 2)).toEqual({
      size: 1000,
      rows: 1000,
      credits: 120,
      seconds: 410,
      needsConfirm: false,
      quotaLimited: false,
      fitsRows: null,
      allowed: true,
    });
    // A plan with 1,500 Jev answers left fits 750 rows of two questions.
    const limited = choiceCost(
      { ...estimate, questions: 1, quota_max_rows: 1500 },
      1000,
      2,
    );
    expect(limited).toMatchObject({
      quotaLimited: true,
      fitsRows: 750,
      allowed: false,
    });
    const all = choiceCost(estimate, null, 1);
    expect(all).toMatchObject({ rows: 104233, needsConfirm: true });
    expect(all.allowed).toBe(false);
    expect(durationWords(20857)).toBe("about 5 h 48 min");
  });

  it("reads the rows handed over by id", () => {
    expect(handedIds({ population: [{ id: "a" }, { id: 2 }, {}] })).toEqual([
      "a",
      "2",
    ]);
    expect(handedIds({ ids: ["x", null] })).toEqual(["x"]);
    expect(handedIds({ filters: [] })).toBeNull();
  });
});

describe("links keep the tab bar on the view the rows came from", () => {
  it("opens the Ask page with the hand-off and the source tab", () => {
    const link = askLink("p1", {
      unit: "sessions",
      label: "Past 7D",
      filters: [{ column_id: "status" }],
    });
    const url = new URL(link, "http://app.test");
    expect(url.pathname).toBe("/dashboard/observe/p1/ask");
    expect(url.searchParams.get("new")).toBe("1");
    expect(url.searchParams.get("unit")).toBe("sessions");
    expect(url.searchParams.get("tab")).toBe("sessions");
    expect(readHandoff(url.searchParams.get("seed"))).toMatchObject({
      unit: "sessions",
      label: "Past 7D",
    });
    const spans = new URL(askLink("p1", { unit: "spans" }), "http://app.test");
    expect(spans.searchParams.get("tab")).toBe("spans");
  });

  it("goes back to each source view with its tab", () => {
    expect(sourceViewLink("p1", "sessions")).toBe(
      "/dashboard/observe/p1/sessions?tab=sessions",
    );
    expect(sourceViewLink("p1", "users")).toBe(
      "/dashboard/observe/p1/users?tab=users",
    );
    expect(sourceViewLink("p1", "spans")).toContain("tab=spans");
    expect(sourceViewLink("p1", "traces")).toContain("tab=traces");
    expect(tabForUnit("sessions")).toBe("sessions");
    expect(tabForUnit("nonsense")).toBe("traces");
  });

  it("filters the Traces list to the chosen rows", () => {
    const rows = [
      record("s1", "2026-10-13T14:00:00Z"),
      record("s2", "2026-10-13T15:00:00Z"),
    ];
    const url = new URL(
      rowsGridLink("p1", "sessions", rows),
      "http://app.test",
    );
    expect(url.pathname).toBe("/dashboard/observe/p1/llm-tracing");
    expect(url.searchParams.get("tab")).toBe("traces");
    const [filter] = JSON.parse(
      url.searchParams.get(OBSERVE_LINK_FILTER_PARAM),
    );
    expect(filter).toMatchObject({
      column_id: "session_id",
      filter_config: { filter_op: "in", filter_value: ["s1", "s2"] },
    });
    // The list's own default window may not reach back to these rows.
    expect(url.searchParams.get("primaryTraceDateFilter")).toContain("Custom");

    const spans = [
      { ...record("span-1", "2026-10-13T14:00:00Z"), trace_id: "t1" },
      { ...record("span-2", "2026-10-13T14:01:00Z"), trace_id: "t1" },
    ];
    const spanUrl = new URL(
      rowsGridLink("p1", "spans", spans),
      "http://app.test",
    );
    const [spanFilter] = JSON.parse(
      spanUrl.searchParams.get(OBSERVE_LINK_FILTER_PARAM),
    );
    expect(spanFilter.column_id).toBe("trace_id");
    expect(spanFilter.filter_config.filter_value).toEqual(["t1"]);
    // Users have no list filter by id.
    expect(rowsGridLink("p1", "users", rows)).toBeNull();
    expect(rowsGridLink("p1", "sessions", [])).toBeNull();
  });
});

describe("the page's words", () => {
  it("spells out the views' short date labels", () => {
    expect(scopeWords("Past 7D")).toBe("Past 7 days");
    expect(scopeWords("Past 7D · 2 filters")).toBe("Past 7 days · 2 filters");
    expect(scopeWords("Past 3M")).toBe("Past 3 months");
    expect(scopeWords("Past 6 hrs")).toBe("Past 6 hours");
    expect(scopeWords("Past 30 mins")).toBe("Past 30 minutes");
    expect(scopeWords("Today")).toBe("Today");
    expect(scopeWords(undefined)).toBe("");
  });

  it("sums up a row's facets", () => {
    expect(
      facetLine({
        model: "gpt-4o-mini",
        turns: 3,
        duration_ms: 148000,
        error: false,
      }),
    ).toBe("gpt-4o-mini · 3 turns · 2 min 28 s");
    expect(
      facetLine({ model: null, turns: 1, duration_ms: null, error: true }),
    ).toBe("1 turn · errored");
    expect(facetLine()).toBe("");
  });

  it("groups History by day", () => {
    const now = new Date(2026, 9, 15, 12);
    expect(dayGroup(new Date(2026, 9, 15, 9), now)).toBe("Today");
    expect(dayGroup(new Date(2026, 9, 14, 9), now)).toBe("Yesterday");
    expect(dayGroup(new Date(2026, 9, 11, 9), now)).toBe("Earlier this week");
    expect(dayGroup(new Date(2026, 8, 1), now)).toBe("Older");
    expect(dayGroup("not a date", now)).toBe("Older");
  });
});

describe("a new question's scope", () => {
  it("starts from the past week when nothing was handed over", () => {
    const scope = lastWeekScope("sessions", new Date("2026-10-15T12:34:56Z"));
    expect(scope.label).toBe("Past 7 days");
    const [start, end] = scope.filters[0].filter_config.filter_value;
    expect(new Date(end) - new Date(start)).toBeGreaterThanOrEqual(
      7 * 24 * 3600 * 1000,
    );
    expect(new Date(start).getMinutes()).toBe(0);
  });
});

describe("rows Jev couldn't answer", () => {
  // The finished Sample 1,000 run: 568 Yes, 325 No, 107 couldn't be answered.
  const run = {
    sample: { is_sample: true, population: 24473, read: 1000 },
    summary: { counts: { [C1]: { Yes: 568, No: 325, __error__: 107 } } },
  };
  const yesNo = { configId: C1, answerType: "yes_no" };

  it("bounds a share by counting them all one way, then the other", () => {
    const bounds = unansweredBounds(run, yesNo, ["No"]);
    expect(bounds.failed).toBe(107);
    expect(bounds.n).toBe(1000);
    expect(bounds.share).toBeGreaterThan(UNANSWERED_BOUND_SHARE);
    const [no] = bounds.bounds;
    // 325/1,000 at the low end and 432/1,000 at the high end, each with
    // its 95% interval.
    expect(no.lo).toBeCloseTo(wilson(325, 1000, 24473).lo, 6);
    expect(no.hi).toBeCloseTo(wilson(432, 1000, 24473).hi, 6);
    expect(no.lo).toBeLessThan(0.325);
    expect(no.hi).toBeGreaterThan(0.432);
    expect(boundWords(bounds, yesNo)).toMatch(
      /^107 of 1,000 couldn't be answered\. If they were all Yes or all No, No would be \d+–\d+%\.$/,
    );
  });

  it("gives each of a category question's answers its own bounds", () => {
    const category = { configId: C1, answerType: "category" };
    const counts = {
      "Order status": 300,
      Refund: 250,
      Other: 350,
      __error__: 100,
    };
    const bounds = unansweredBounds(
      { ...run, summary: { counts: { [C1]: counts } } },
      category,
      ["Other", "Order status"],
    );
    expect(boundWords(bounds, category)).toMatch(
      /^100 of 1,000 couldn't be answered\. Counting them as all or none of each answer: Other \d+–\d+% · Order status \d+–\d+%\.$/,
    );
  });

  it("is only a note when few rows went unanswered, and nothing when none did", () => {
    const few = unansweredBounds(
      {
        ...run,
        summary: { counts: { [C1]: { Yes: 600, No: 390, __error__: 10 } } },
      },
      yesNo,
      ["No"],
    );
    expect(few.share).toBeLessThanOrEqual(UNANSWERED_BOUND_SHARE);
    expect(
      unansweredBounds(
        { ...run, summary: { counts: { [C1]: { Yes: 600, No: 400 } } } },
        yesNo,
        ["No"],
      ),
    ).toBeNull();
  });

  it("splits a past run over the rows Jev answered, as its page does", () => {
    const split = answeredSplit(
      { labels: ["Yes", "No"] },
      { Yes: 568, No: 325, __error__: 107 },
    );
    expect(split).toMatchObject({ answered: 893, failed: 107 });
    expect(Math.round(split.labels[0].share * 100)).toBe(64);
  });
});

describe("how long a run took", () => {
  it("counts the time it ran, with the time it sat idle apart", () => {
    const run = {
      elapsedMs: 15240000,
      summary: { active_s: 2460, idle_s: 12780 },
    };
    expect(runTime(run, " in ")).toBe(" in 41 min (idle 3 h 33 min)");
    expect(runTime(run, "running ")).toBe("running 41 min (idle 3 h 33 min)");
    // A minute between answers is still running.
    expect(
      runTime({ summary: { active_s: 2460, idle_s: 60 } }, "running "),
    ).toBe("running 41 min");
    // A summary without the split: the wall time since it started.
    expect(runTime({ elapsedMs: 21000, summary: {} }, " in ")).toBe(" in 21 s");
  });
});
