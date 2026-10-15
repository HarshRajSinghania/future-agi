/*
  What a finished run actually scored, read from its scenarios — the same
  outcomes the run screen shows (Passing / Mixed / Failing / Not measured).

  A run record also stores `passed` / `total` from when it was seeded or
  finished; those can drift from the scenarios the run rebuilds, which put a
  99% on the agent page next to 13 failing scenarios on the run screen. Every
  summary of a run reads this instead.

  rate is the run screen's own pass rate (run/taskOutcome.js): the mean share
  of repeats that passed, over measured scenarios — a mixed scenario counts
  for the repeats it passed, and one that never got a verdict (something
  upstream of the agent broke) isn't counted against the agent.
*/
import { runSummaries } from "./comparison";
import { outcomeTally, passRateOf } from "../run/taskOutcome";

/* Rebuilding a run is the costly part — once per environment state. */
const cache = new WeakMap();
const summariesOf = (env, envState) => {
  if (!envState) return [];
  let byEnv = cache.get(envState);
  if (!byEnv) { byEnv = new Map(); cache.set(envState, byEnv); }
  if (!byEnv.has(env.id)) byEnv.set(env.id, runSummaries(env, envState));
  return byEnv.get(env.id);
};

export const runResultOf = (env, envState, run) => {
  if (!run) return run;
  const tasks = env ? summariesOf(env, envState).find((x) => x.id === run.id)?.tasks : null;
  if (!tasks?.length) {
    const measured = run.measured ?? run.total ?? 0;
    return { ...run, measured, rate: measured ? Math.round(((run.passed || 0) / measured) * 100) : null };
  }
  const t = outcomeTally(tasks);
  const rate = passRateOf(tasks);
  return {
    ...run,
    total: t.total,
    passed: t.passed,
    failed: t.failed,
    flaky: t.flaky,
    unmeasured: t.unmeasured,
    measured: t.measured,
    rate: rate == null ? null : Math.round(rate),
  };
};
