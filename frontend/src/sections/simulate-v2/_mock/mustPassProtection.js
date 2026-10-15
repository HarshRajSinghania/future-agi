/*
  What protects a scenario from an improvement — the three-part must-pass set
  the improvement gate already uses (RSI PRD): what the user marked, regression
  memory, and every other scenario that passes all its repeats on the current
  version. The anchor core is held the same way.

  The Scenarios tab says it out loud, so a set of hundreds doesn't look like it
  needs hand-marking: most of it is protected because it passes today. Marking
  is for what must never break, including what is still flaky.

  Marks can also sit on a goal: every scenario in it is must-pass, and ones
  added to the goal later join it.
*/
import { tierOf } from "./tiers";

/* A goal's key — the slug of its use-case sentence, as the table groups it. */
export const goalKeyOf = (row) => {
  const text = row?.useCase;
  return text ? text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : null;
};

export const mustPassGoalsOf = (envState) => envState?.mustPassGoals || [];
export const isMustPassGoal = (envState, key) => !!key && mustPassGoalsOf(envState).includes(key);

/** The goal list with `key` added or taken out. */
export const withMustPassGoal = (envState, key, on) => {
  const list = mustPassGoalsOf(envState).filter((k) => k !== key);
  return on ? [...list, key] : list;
};

/* A scenario added to a must-pass goal joins it. */
export const inheritsMustPass = (row, envState) => !row?.critical && isMustPassGoal(envState, goalKeyOf(row));

/*
  One scenario's protection, from its marks and its latest run (`latest`:
  { task, name } — the environment's latest run it was in).
    marked   · the user marked it, or wrote it must-pass
    memory   · kept from a released fix
    anchor   · in the anchor core
    passing  · passed every repeat in the latest run
    open     · nothing holds it — it fails sometimes, or hasn't run
*/
export const protectionOf = (row, latest) => {
  if (!row || row.archived) return { id: "off", label: "Not run", line: "Archived — it doesn't run or count." };
  if (row.regressionMemory) {
    return { id: "memory", label: "Regression memory", line: `Kept from the fix for ${row.regressionMemory.issueId} — an improvement that breaks it is rejected.` };
  }
  if (row.critical) {
    return { id: "marked", label: "Must-pass", line: row.mustPassGoal ? "Marked with its goal — an improvement that breaks it is rejected." : "An improvement that breaks it is rejected." };
  }
  if (tierOf(row) === "anchor") return { id: "anchor", label: "Anchor core", line: "In the anchor core — an improvement that breaks it is rejected." };
  const t = latest?.task;
  if (t && !t.pulled && t.status === "passed") {
    return { id: "passing", label: "Protected", line: `Passed every repeat in ${latest.name}, so an improvement can't break it. Mark it must-pass to keep it protected if it starts to fail.` };
  }
  const why = !t || t.pulled ? "It hasn't been scored yet" : t.status === "flaky" ? `It passed only some repeats in ${latest.name}` : `It failed in ${latest.name}`;
  return { id: "open", label: "Not protected", line: `${why}, so an improvement may change how it does. Mark it must-pass if it must never break.` };
};

/** The set's tally: how much of it improvements can't break, and why. */
export const protectionTally = (rows, latestOf) => {
  const out = { marked: 0, memory: 0, anchor: 0, passing: 0, open: 0, total: 0, latestName: null };
  (rows || []).forEach((r) => {
    if (r.archived) return;
    const latest = latestOf ? latestOf(r) : null;
    if (latest?.name && !out.latestName) out.latestName = latest.name;
    out[protectionOf(r, latest).id] += 1;
    out.total += 1;
  });
  return out;
};

/*
  Goals worth making must-pass: ones that test a rule or stand up to pressure
  — what a team usually means by "must never break" — where some scenarios are
  must-pass and some aren't. A goal that's already must-pass, or one the user
  said "not now" to, isn't asked about again.
*/
const RULE_LIKE = /^(rule enforcement|adversarial|safety)/i;
export const mustPassSuggestionsOf = (rows, envState) => {
  const dismissed = new Set(envState?.mustPassSuggestDismissed || []);
  const goals = new Map();
  (rows || []).forEach((r) => {
    if (r.archived || r.proposed || r.canary) return;
    const key = goalKeyOf(r);
    if (!key || isMustPassGoal(envState, key) || dismissed.has(key)) return;
    if (!RULE_LIKE.test(r.branchCategory || "") && !/^(refuse|resist)\b/i.test(r.useCase || "")) return;
    if (!goals.has(key)) goals.set(key, { key, label: r.useCase, rows: [] });
    goals.get(key).rows.push(r);
  });
  return [...goals.values()]
    .map((g) => ({ ...g, marked: g.rows.filter((r) => r.critical).length }))
    .filter((g) => g.rows.length > 1 && g.marked < g.rows.length);
};
