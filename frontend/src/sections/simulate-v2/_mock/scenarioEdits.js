/*
  What an edit to one scenario does to its version — PRD v7 §4.10.3.

  Every edit bumps by KIND, never by how much changed, and the kind is
  stated before saving with what it does to past results:

    patch   cosmetic: name, description, labels            → past results reused
    minor   a grader fix on its checks, same intent          → past runs re-graded
    major   what the caller does: instruction, persona,
            fixture identity, setup — or a rewrite after
            it was outdated                                   → re-run; not comparable
                                                                until bridged

  Set-level marks (tier, canary, the old `critical` flag) aren't the
  scenario's content: they move S, not the scenario.
*/
import { bumpScenario, SCENARIO_BUMPS } from "./decoupled";
import { BUMP_RANK } from "./suiteLog";

const COSMETIC = ["name", "title", "summary", "description", "labels", "tags"];
const GRADER = ["expected", "outcome", "idealOutcome", "subGoals", "subGoalMarks", "checks"];
const CALLER = [
  "task", "situation", "persona", "caller", "turns", "backgroundNoise", "setup", "fixture",
  "twinSeedPrompt", "requiredTools", "conversationBranch", "branchCategory", "useCase",
];
/* Marks on the set, and bookkeeping — not the scenario's content. */
export const META_FIELDS = [
  "tier", "canary", "critical", "criticalBy", "criticalWas", "callerEdited", "subGoalsUnproved",
  "editedAt", "provedAt", "provedIn", "ruleChecked", "version", "versionLog", "archived", "proposed",
];

const LABEL = {
  name: "name", title: "title", summary: "description", description: "description", labels: "labels", tags: "labels",
  expected: "passes-when", outcome: "passes-when", idealOutcome: "passes-when", subGoals: "sub-goals",
  subGoalMarks: "sub-goal marks", checks: "checks",
  task: "caller instruction", situation: "caller instruction", persona: "persona", caller: "caller",
  turns: "call constraints", backgroundNoise: "call constraints", setup: "setup", fixture: "fixture",
  twinSeedPrompt: "setup", requiredTools: "tools", conversationBranch: "path", branchCategory: "path", useCase: "use case",
};

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The fields that differ, by group. */
export const changedFields = (before = {}, after = {}) => {
  const diff = (keys) => keys.filter((k) => !same(before[k], after[k]));
  /* Anything else on a row is bookkeeping (provenance, proof stamps) — an
     edit never writes it, so it never decides a bump. */
  return { cosmetic: diff(COSMETIC), grader: diff(GRADER), caller: diff(CALLER), meta: diff(META_FIELDS) };
};

const words = (keys) => [...new Set(keys.map((k) => LABEL[k] || k))].join(", ");

/**
 * The bump an edit makes. `intent` answers the one question a grader edit
 * leaves open: "same" (a fix) or "changed" (it tests something else now —
 * a major). → { level, why, fields, graderEdit, rewrite, prior } — level
 * null when only set-level marks moved.
 */
const bumpOf = (before, after, intent) => {
  const f = changedFields(before, after);
  const rewrite = !!before?.outdatedBy;
  const graderEdit = f.grader.length > 0;
  if (rewrite && (f.caller.length || graderEdit || f.cosmetic.length)) {
    return { level: "major", why: `Rewritten after it was outdated — ${words([...f.caller, ...f.grader, ...f.cosmetic])}`, fields: f, graderEdit, rewrite };
  }
  if (f.caller.length) return { level: "major", why: `Changed ${words(f.caller)}`, fields: f, graderEdit, rewrite };
  if (graderEdit) {
    return intent === "changed"
      ? { level: "major", why: `Changed what it tests — ${words(f.grader)}`, fields: f, graderEdit, rewrite }
      : { level: "minor", why: `Grader fix — ${words(f.grader)}`, fields: f, graderEdit, rewrite };
  }
  if (f.cosmetic.length) return { level: "patch", why: `Renamed or relabelled — ${words(f.cosmetic)}`, fields: f, graderEdit, rewrite };
  return { level: null, why: null, fields: f, graderEdit, rewrite };
};

/* The bump also carries the version it replaces (`prior`), so applying it
   keeps that version's content for runs that pinned it (§4.10.8). */
export const editBumpOf = (before, after, { intent = "same" } = {}) => ({ ...bumpOf(before, after, intent), prior: before || null });

/** What the bump does, in a sentence — the line shown before Save. */
export const bumpNote = (level) => (level ? SCENARIO_BUMPS[level].note : "Only how the set treats it changed — the scenario keeps its version.");

/** The row with its bump applied, or as it is when nothing bumped. The
 *  replaced version is snapshotted into the log entry (see bumpScenario). */
export const applyEditBump = (after, bump) => (bump?.level ? bumpScenario(after, bump.level, bump.why, bump.prior || undefined) : after);

export const biggest = (levels = []) => levels.reduce((m, l) => ((BUMP_RANK[l] || 0) > (BUMP_RANK[m] || 0) ? l : m), null);
