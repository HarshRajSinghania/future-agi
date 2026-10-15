/*
  The scenario set's own version log — PRD v7 §4.10.2/§4.10.3.

  Every change to S (scenarios added, edited, archived or restored, a tier
  moved, a sub-goal published) is a new S version with a one-line change
  summary, and the summary reports the largest scenario bump it caused.
  Nothing is rewritten in place: an entry is appended, never edited.

    envState.suiteVersions = [{ label, at, summary, largestBump, by? }]
      label        "s5" — always past the last one, and never behind
                   envModel's computed suiteVersionOf
      largestBump  "major" | "minor" | "patch" | null (nothing bumped:
                   an add, an archive, a policy change)

  The version bar reads this through `suiteVersionLogOf`, which also folds in
  the S changes a nudge made (nudgeEffects.js keeps those, newest first, on
  envState.suiteLog as { id, at, kind, summary, nudgeId, bump }) — labelled
  in order, so one list tells the whole history of S.
*/
import { suiteVersionOf } from "./envModel";

export const BUMP_RANK = { patch: 1, minor: 2, major: 3 };

/** The larger of two bumps (null = nothing bumped). */
export const largerBump = (a, b) => ((BUMP_RANK[b] || 0) > (BUMP_RANK[a] || 0) ? b : a) || null;

const num = (label) => Number(String(label || "").replace(/^s/, "")) || 0;

/* A nudge's S change, in this log's shape. A rewrite bumps each rewritten
   scenario a major version; the rest bump none. */
const NUDGE_BUMP = { rewrite: "major" };
const fromNudge = (l) => ({
  label: null, at: l.at, summary: l.summary, largestBump: NUDGE_BUMP[l.kind] || null, kind: l.kind, nudgeId: l.nudgeId || null,
});

/** Every logged S version, oldest first — edits here and the nudges' changes alike. */
export const suiteVersionLogOf = (envState) => {
  const own = envState?.suiteVersions || [];
  const nudged = (envState?.suiteLog || []).map(fromNudge);
  if (!nudged.length) return own;
  const merged = [...own, ...nudged].sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
  /* Unlabelled entries count up to where the computed version stands. */
  let n = Math.max(0, num(suiteVersionOf(envState)) - nudged.length);
  return merged.map((e) => {
    if (e.label) { n = Math.max(n, num(e.label)); return e; }
    n += 1;
    return { ...e, label: `s${n}` };
  });
};

/**
 * The S version the set is on: the computed one, or the last logged one when
 * the log is ahead of it (a change the computed count doesn't see — an
 * archive, a tier move, a second edit to one scenario).
 */
export const currentSuiteLabel = (envState) => {
  const computed = suiteVersionOf(envState);
  const last = suiteVersionLogOf(envState).slice(-1)[0];
  return last && num(last.label) > num(computed) ? last.label : computed;
};

/**
 * Patch that writes the next S version. `next` is the envState patch the
 * change already makes (scenarios, subGoalEdits …) — the label is read from
 * the state after it, so an add that the computed count sees isn't counted
 * twice.
 */
export const suiteLogPatch = (envState, next, { summary, largestBump = null, by = null } = {}) => {
  const after = { ...envState, ...next };
  const label = `s${Math.max(num(suiteVersionOf(after)), num(currentSuiteLabel(envState)) + 1)}`;
  return {
    ...next,
    suiteVersions: [
      ...(envState?.suiteVersions || []),
      { label, at: new Date().toISOString(), summary, largestBump: largestBump || null, ...(by && { by }) },
    ],
  };
};

/** "minor" → "re-graded"; how a bump is said in a change summary. */
export const BUMP_PAST = { patch: "reused", minor: "re-graded", major: "re-run" };

/** "largest bump: minor (re-graded)" — or "no scenario bumped". */
export const largestBumpLine = (bump) => (bump ? `largest bump: ${bump} (${BUMP_PAST[bump]})` : "no scenario bumped");
