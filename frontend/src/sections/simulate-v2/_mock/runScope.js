/*
  What a full Run takes — one count for every place that says it (the Run
  button and its tooltip, Repeats, the evals cost, the first-run offer).

  The plan's scenarios (what can stage on the version in use), minus the ones
  resting on an open or skipped optional question in Needs input: Run anyway
  leaves those out. A scenario on such a question that can't stage anyway
  doesn't count as sitting out — it was never in the run.
*/
import { runPlan } from "./proofs";
import { gapCoverage, setupGaps } from "./setupGaps";

/**
 * { plan, runnable, ids, count, sitOut, sitOutGaps }
 *   runnable   — scenarios that can stage
 *   ids/count  — the ones a full Run takes
 *   sitOut     — runnable − count
 *   sitOutGaps — how many open questions those wait on
 * Pass `plan` / `gaps` when the caller already has them.
 */
export const runScopeOf = (env, envState, { plan = null, gaps = null } = {}) => {
  const p = plan || runPlan(env, envState);
  const all = gaps || setupGaps(env, envState);
  const cover = gapCoverage(env, envState, all);
  const run = p?.run || [];
  const ids = run.filter((sc) => !cover.attribution[sc.id]).map((sc) => sc.id);
  const sitOutIds = new Set(run.map((sc) => sc.id).filter((id) => cover.attribution[id]));
  const sitOutGaps = all.filter((g) => (g.status === "optional" || g.status === "skipped")
    && (g.coverage || []).some((id) => sitOutIds.has(id))).length;
  return { plan: p, runnable: run.length, ids, count: ids.length, sitOut: sitOutIds.size, sitOutGaps };
};
