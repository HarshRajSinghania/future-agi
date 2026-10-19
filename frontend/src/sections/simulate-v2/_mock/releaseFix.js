/*
  Releasing a fix — the moment it becomes the baseline and the Error Feed
  starts watching.

  The release is recorded on the environment (detected from the platform or
  production traces, or marked by hand).

  Regression memory: an Error Feed fix can leave its issue behind as
  permanent must-pass scenarios, so a fixed issue can't quietly come back —
  and so can every other improvement with targets (Debug failures, a goal, a
  schedule), its target scenarios kept the same way (owner decision). It
  asks first — "Add 4 scenarios that pass every repeat on the released
  version as must-pass?" — and only the ones that passed every repeat are
  offered. The ones that still fail sometimes stay targets: making a flaky
  scenario must-pass would block every later change on noise.

  "Passed every repeat on the released version" is read from a run on that
  version, not from the search's "fixed": when a fix is released, a
  confirmation run of its targets on the released version is recorded with
  the release (`releaseConfirmations[optId]`). The search proved a
  candidate; this proves what actually shipped.
*/

import { addImprovementScenariosPatch } from "./improvementScenarios";
import { REPEATS } from "./optimizationRuns";

const isFix = (record) => record?.trigger?.kind === "error-feed" || record?.trigger?.source === "run-insights";

const hash = (s) => {
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/*
  An improvement's targets: for a fix, its issue's scenarios that failed
  before it; for any other improvement, the target scenarios it was run on —
  every one that failed before the change (what it did to each tells: fixed,
  still failing, flaky — never unchanged or broke, which passed before).
*/
const FAILED_BEFORE = new Set(["fixed", "still-failing", "flaky", "inconclusive"]);
const targetsOf = (record) => {
  const r = record?.result;
  if (!r?.winner) return [];
  const rows = [
    ...(r.trainMeasuredTasks || []).map((t) => ({ ...t, outcome: r.winner.perScenario?.[t.id] })),
    ...(r.heldTasks || []).map((t) => ({ ...t, outcome: r.heldPerScenario?.[t.id] })),
  ];
  if (isFix(record)) {
    const issueId = record.trigger.issueId;
    return rows.filter((t) => t.fromIssue === issueId && t.before !== "passed");
  }
  return rows.filter((t) => FAILED_BEFORE.has(t.outcome));
};

/**
 * The confirmation run on the released version: each target, every repeat.
 * Deterministic on the scenario and the version — a scenario the search
 * fixed usually passes all three, now and then not; one it didn't fix
 * still fails some. → { version, at, of, perScenario: { [id]: passes } }
 */
export const confirmationRunOf = (record, version, at = new Date().toISOString()) => {
  const perScenario = {};
  targetsOf(record).forEach((t) => {
    const h = hash(`${t.id}:${version}:confirm`) % 100;
    perScenario[t.id] = t.outcome === "fixed" ? (h < 85 ? REPEATS : REPEATS - 1) : h % REPEATS;
  });
  return { version, at, of: REPEATS, perScenario };
};

/**
 * Record the release — and, for an improvement with targets, the
 * confirmation run of them on the released version. Regression memory is a
 * separate, approved step.
 */
export const releasePatch = (envState, { version, optId, detected = false, at = new Date().toISOString() }) => {
  const record = (envState?.optimizations || []).find((o) => o.id === optId);
  /* A fix's release names its issue, so the Error Feed's watch can tell
     this issue's first released fix from a later one. */
  const issueId = record?.trigger?.issueId || null;
  const release = {
    version, runId: null, at, gate: detected ? "detected" : "improvement", optId: optId || null,
    ...(issueId && { issueId }), ...(detected && { detected: true }),
  };
  const confirm = targetsOf(record).length ? confirmationRunOf(record, version, at) : null;
  return {
    patch: {
      releases: [release, ...(envState?.releases || [])],
      ...(confirm && { releaseConfirmations: { ...(envState?.releaseConfirmations || {}), [optId]: confirm } }),
    },
    remembered: [],
  };
};

/**
 * The targets a release could keep as must-pass: those that passed
 * every repeat of the confirmation run on the released version. The ones
 * still failing sometimes stay targets.
 * { mustPass: [{ id, title }], targets: [{ id, title }], confirmation }
 */
export const memoryCandidates = (envState, optId) => {
  const record = (envState?.optimizations || []).find((o) => o.id === optId);
  const rows = targetsOf(record);
  if (!rows.length) return { mustPass: [], targets: [], confirmation: null };
  /* A release recorded before confirmation runs existed gets its run now,
     on the version it released — the same verdict either way. */
  const released = (envState?.releases || []).find((r) => r.optId === optId)?.version
    || envState?.handoffLandings?.[optId] || null;
  const confirmation = envState?.releaseConfirmations?.[optId] || (released ? confirmationRunOf(record, released) : null);
  if (!confirmation) return { mustPass: [], targets: rows.map((t) => ({ id: t.id, title: t.title })), confirmation: null };
  const already = new Set((envState?.scenarios || []).filter((s) => s.regressionMemory).map((s) => s.id));
  const pick = (t) => ({ id: t.id, title: t.title, passes: confirmation.perScenario?.[t.id] ?? 0, of: confirmation.of });
  const everyRepeat = (t) => (confirmation.perScenario?.[t.id] ?? 0) >= confirmation.of;
  return {
    mustPass: rows.filter((t) => everyRepeat(t) && !already.has(t.id)).map(pick),
    targets: rows.filter((t) => !everyRepeat(t)).map(pick),
    confirmation,
  };
};

/**
 * The approved regression memory: those scenarios become must-pass. One the
 * improvement still holds (not yet in the environment) is added first, the
 * same way "Add N scenarios to the environment" adds it, so the memory has
 * something to stand on.
 */
export const rememberPatch = (envState, { optId, ids, version, at = new Date().toISOString() }) => {
  const record = (envState?.optimizations || []).find((o) => o.id === optId);
  const want = new Set(ids);
  /* Named by its issue; an improvement without one by its own name, so
     "Kept from …" still reads where it's shown. */
  const memory = { issueId: record?.trigger?.issueId || record?.name || optId, ...(!record?.trigger?.issueId && { fromImprovement: true }), version, optId, at };
  const have = new Set((envState?.scenarios || []).map((s) => s.id));
  const toAdd = ids.filter((id) => !have.has(id));
  const added = toAdd.length && record ? addImprovementScenariosPatch(envState, record, toAdd, { at }) : {};
  const rows = added.scenarios || envState?.scenarios || [];
  return {
    ...added,
    scenarios: rows.map((s) => (want.has(s.id) && !s.regressionMemory ? { ...s, critical: true, regressionMemory: memory } : s)),
    memoryDecisions: { ...(envState?.memoryDecisions || {}), [optId]: { decision: "added", ids, at } },
  };
};

/** "Not now" — asked once per release. */
export const declineMemoryPatch = (envState, optId, at = new Date().toISOString()) => ({
  memoryDecisions: { ...(envState?.memoryDecisions || {}), [optId]: { decision: "declined", at } },
});

/** The scenarios a release turned into must-pass ones. */
export const rememberedFor = (envState, optId) => (envState?.scenarios || []).filter((s) => s.regressionMemory?.optId === optId);

/**
 * Where a released improvement's regression memory stands — read the same
 * way on the improvement page and the Error Feed issue (RSI PRD: "a fixed
 * issue's scenarios become permanent must-pass scenarios once the user
 * approves"; owner decision: every improvement with targets).
 *   status: "pending"  — scenarios to offer, not decided yet
 *           "declined" — offered, Not now; still reversible
 *           "kept"     — every one offered is must-pass now
 *           "none"     — nothing passed every repeat yet (they stay targets)
 * Null until the fix is released.
 */
export const regressionMemoryOf = (envState, optId) => {
  if (!optId) return null;
  const release = (envState?.releases || []).find((r) => r.optId === optId);
  if (!release) return null;
  const { mustPass: offer, targets, confirmation } = memoryCandidates(envState, optId);
  const kept = rememberedFor(envState, optId);
  const decision = envState?.memoryDecisions?.[optId]?.decision || null;
  const status = offer.length
    ? (decision === "declined" ? "declined" : "pending")
    : kept.length ? "kept" : "none";
  return { status, offer, targets, kept, confirmation, version: release.version };
};
