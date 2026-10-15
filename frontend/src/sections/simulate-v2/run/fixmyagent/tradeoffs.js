/*
  Trade-offs between candidates: quality against cost per conversation and
  latency. The search picks the best-scoring candidate that keeps every
  constraint; someone may prefer one a little lower that costs less or
  answers faster. The frontier is the set where nothing else is at least as
  good on all three and better on one.
*/
import { winnerEffect, COST_NOISE } from "../../_mock/optimizationRuns";

export const candidatesOf = (record) => {
  const r = record?.result;
  if (!r) return [];
  const limits = record.limits || {};
  return r.trials.map((t) => {
    const proposals = (r.pool || []).filter((p) => t.picks.includes(p.id));
    const effect = winnerEffect({ proposals, costSavings: t.costSavings });
    /* "No increase" allows the noise two runs differ by, on newer records. */
    const ceiling = limits.costCeiling ?? 5;
    const tol = record.frozen?.costNoise && ceiling <= 0 ? COST_NOISE : 0;
    const overCost = effect.cost > ceiling + tol;
    const overLatency = effect.latency > (limits.latencyCeiling ?? 10);
    /* Stopped at Fits the environment — never ran, never eligible. */
    const unfit = (!!t.compat && t.compat.pass === false) || (!!t.static && t.static.pass === false);
    return {
      n: t.n,
      score: t.score,
      delta: t.delta,
      cost: effect.cost,
      latency: effect.latency,
      proposals,
      brokeBlocker: t.brokeBlocker,
      cheated: !!t.cheats,
      eligible: !t.brokeBlocker && !t.cheats && !(t.repoTests && !t.repoTests.pass) && !unfit && !overCost && !overLatency,
      repoFailed: !!t.repoTests && !t.repoTests.pass,
      ...(unfit && { unfit: true }),
      why: t.cheats ? "cheated" : t.brokeBlocker ? "a must-pass failure repeated" : unfit ? (t.static && t.static.pass === false ? "failed a static check" : "doesn't fit the sealed environment") : t.repoTests && !t.repoTests.pass ? "broke the repository's tests" : overCost ? "over the cost limit" : overLatency ? "over the latency limit" : null,
    };
  });
};

const dominates = (a, b) => a.score >= b.score && a.cost <= b.cost && a.latency <= b.latency
  && (a.score > b.score || a.cost < b.cost || a.latency < b.latency);

/** Eligible candidates nothing else beats on quality, cost and latency at once. */
export const frontierOf = (candidates) => {
  const ok = candidates.filter((c) => c.eligible);
  /* One per distinct point — repeated trials of the same change land together. */
  const seen = new Set();
  return ok
    .filter((c) => !ok.some((o) => o !== c && dominates(o, c)))
    .filter((c) => {
      const k = `${c.score}:${c.cost}:${c.latency}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.cost - b.cost || b.score - a.score);
};

/**
 * The held-back rate a chosen candidate would likely reach. A finalist was
 * scored there once, at the end — that number stands. Anyone else's is scaled
 * from what the winner did there by how much of its training lift it keeps,
 * shown as a projection.
 */
export const projectedHeld = (result, candidate) => {
  const w = result?.winner;
  if (!w || !candidate) return null;
  if (candidate.n === w.n) return result.heldScore;
  const finalist = (result.finalists || []).find((f) => f.n === candidate.n);
  if (finalist) return finalist.heldScore;
  const lift = result.heldScore - result.heldBase;
  const share = w.delta > 0 ? Math.max(0, Math.min(1.2, candidate.delta / w.delta)) : 1;
  return Math.round(result.heldBase + lift * share);
};

/** What ships: the candidate someone chose on the trade-off view, else the search's pick. */
export const shippedCandidate = (record) => {
  const r = record?.result;
  if (!r?.winner) return null;
  const n = record.preferredTrial;
  if (!n || n === r.winner.n) return { ...r.winner, chosen: false, held: r.heldScore };
  const c = candidatesOf(record).find((x) => x.n === n);
  const t = r.trials.find((x) => x.n === n);
  return c && t ? { ...t, proposals: c.proposals, chosen: true, cost: c.cost, latency: c.latency, held: projectedHeld(r, c) } : { ...r.winner, chosen: false, held: r.heldScore };
};
