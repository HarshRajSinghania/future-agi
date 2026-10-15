/*
  Reading runs against each other — the numbers the Runs tab leads with.

  A run's tasks are one per scenario; each carries `passShare`, the share of
  its repeats that passed. So:
    scenario pass — scenarios that passed a majority of their repeats
    call pass     — every repeat counted (the mean share; pass^1)
  Two runs are compared only on the scenarios both measured, and every change
  comes with the noise two samples of that size carry (95%, binomial), so a
  swing inside it isn't read as a regression or a fix.
*/

const keyOf = (t) => t.scenarioId || t.id;
const shareOf = (t) => t.passShare ?? (t.status === "passed" ? 1 : 0);
/* A verdict for or against the agent — not inconclusive, invalid or errored. */
const measuredTasks = (run) => (run?.tasks || []).filter((t) => !t.pulled && ["passed", "failed", "flaky"].includes(t.status));

/** The columns a run row shows. */
export const runStatsOf = (run) => {
  const m = measuredTasks(run);
  const passed = m.filter((t) => shareOf(t) > 0.5).length;
  const repeats = run?.repeats || 1;
  const took = run?.startedAt && run?.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : null;
  return {
    measured: m.length,
    scenarioPassed: passed,
    scenarioRate: m.length ? Math.round((passed / m.length) * 100) : null,
    callRate: m.length ? Math.round((m.reduce((a, t) => a + shareOf(t), 0) / m.length) * 1000) / 10 : null,
    calls: (run?.tasks || []).length * repeats,
    flaky: m.filter((t) => t.status === "flaky").length,
    failed: m.length - passed,
    tookMs: took && took > 0 ? took : null,
  };
};

const noiseOf = (p1, n1, p2, n2) => Math.max(1, Math.round(1.96 * Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2) * 100));

/**
 * `run` against `base`, on the scenarios both measured:
 * { pts, noise, within, shared } — null when they share fewer than 3.
 */
export const sharedDeltaOf = (run, base) => {
  if (!run || !base) return null;
  const a = new Map(measuredTasks(run).map((t) => [keyOf(t), shareOf(t) > 0.5]));
  const b = new Map(measuredTasks(base).map((t) => [keyOf(t), shareOf(t) > 0.5]));
  const shared = [...a.keys()].filter((k) => b.has(k));
  if (shared.length < 3) return null;
  const p1 = shared.filter((k) => a.get(k)).length / shared.length;
  const p2 = shared.filter((k) => b.get(k)).length / shared.length;
  const pts = Math.round((p1 - p2) * 100);
  const noise = noiseOf(p1, shared.length, p2, shared.length);
  return { pts, noise, within: Math.abs(pts) <= noise, shared: shared.length };
};

/** The run a run is read against: the latest earlier one on the same environment version, else the latest earlier one. */
export const previousRunOf = (runs, run) => {
  if (!run) return null;
  const earlier = runs.filter((r) => r.id !== run.id && (r.ordinal || 0) < (run.ordinal || 0) && r.finishedAt && measuredTasks(r).length);
  const same = earlier.filter((r) => r.envVersion === run.envVersion);
  return [...(same.length ? same : earlier)].sort((x, y) => (y.ordinal || 0) - (x.ordinal || 0))[0] || null;
};

/** Plain words for a delta: "+4 pts ±19 · within noise". */
export const deltaWords = (d) => (d
  ? `${d.pts > 0 ? "+" : ""}${d.pts} pts ±${d.noise} · ${d.within ? "within noise" : d.pts > 0 ? "better" : "worse"}`
  : null);

/* Runs smaller than this are left off the trend — one point from four
   scenarios beside one from forty invites the wrong read. */
const MIN_FOR_TREND = 5;

/**
 * The trend line: scenario pass rate per run, on the scenarios every charted
 * run measured (so the line moves with the agent, not with the suite). Falls
 * back to each run's own scenarios when they share too few.
 *   { points: [{ run, rate, failing }], shared: n | null, left: [run] }
 */
export const trendOf = (runs) => {
  const charted = runs.filter((r) => r.finishedAt && measuredTasks(r).length >= MIN_FOR_TREND);
  const left = runs.filter((r) => r.finishedAt && !charted.includes(r));
  if (!charted.length) return { points: [], shared: null, left };
  const sets = charted.map((r) => new Set(measuredTasks(r).map(keyOf)));
  const common = [...sets[0]].filter((k) => sets.every((s) => s.has(k)));
  const useShared = common.length >= MIN_FOR_TREND;
  const points = charted.map((r) => {
    const tasks = measuredTasks(r).filter((t) => !useShared || common.includes(keyOf(t)));
    const passed = tasks.filter((t) => shareOf(t) > 0.5).length;
    return { run: r, rate: tasks.length ? Math.round((passed / tasks.length) * 100) : 0, failing: tasks.length - passed, of: tasks.length };
  });
  return { points, shared: useShared ? common.length : null, left };
};
