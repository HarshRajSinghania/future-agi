/*
  Reading the sub-goal catalogue for the Contract and Sub-goals tabs.

  The catalogue itself — what's in it, what each entry tests, which scenarios
  use it — is `subGoalCatalogOf` in envModel.js. This is only how those
  entries are worded on screen, and what an edit to one would touch.
*/
import { catalogVersionOf, subGoalsOfScenario, useCaseId as stableUseCaseId } from "./envModel";
import { bumpScenario } from "./decoupled";
import { suiteLogPatch } from "./suiteLog";

export const KIND_META = {
  code: { label: "Code", note: "reads the world and calls" },
  judged: { label: "Judged", note: "LLM criterion" },
};

/** What a code check reads — a connect-only env has only the transcript. */
export const readsNote = (goal) => ({
  transcript: "reads the transcript",
  calls: "reads the calls",
  "world + calls": "reads the world and calls",
}[goal?.reads] || KIND_META[goal?.kind]?.note || "");

export const TESTS_LABEL = { rule: "Rule", tool: "Tool", "use case": "Use case" };

/**
 * What a sub-goal passes on, in a sentence, when nobody has written one yet.
 * Code checks settle against state; judged ones are a criterion a model reads.
 */
export const defaultCriterionOf = (goal, rules = []) => {
  if (!goal) return "";
  const rule = goal.tests?.kind === "rule" ? rules.find((r) => r.id === goal.tests.ref) : null;
  if (goal.kind === "code") {
    if (goal.tests?.kind === "tool") return `Passes when ${goal.tests.ref} is called with the arguments the task needs, checked against the world after the run.`;
    if (rule) return `Passes when the run ends with the rule held — ${rule.text.replace(/\.$/, "")} — checked against the world and the calls.`;
    return `Passes when the calls show the agent did this: ${goal.name.replace(/\.$/, "").toLowerCase()}.`;
  }
  if (rule) return `A judge reads the transcript and passes it when the agent holds to the rule ${rule.id} without breaking it, however it phrases the refusal.`;
  return `A judge reads the transcript and passes it when the agent did this: ${goal.name.replace(/\.$/, "").toLowerCase()}.`;
};

/**
 * A judged check that quotes the prompt word for word grades the wording, not
 * the behaviour — the next prompt edit that rephrases the line fails it.
 * Heuristic: double quotes, or asking for the exact words.
 */
export const quotesPromptVerbatim = (goal, criterion = goal?.criterion) => {
  if (goal?.kind !== "judged") return false;
  const text = `${goal?.name || ""} ${criterion || ""}`;
  return /["“”]/.test(text) || /\b(exact|exactly|verbatim|word for word)\b/i.test(text);
};

/** The catalogue version an edit saved now would create. */
export const nextCatalogVersion = (envState) => `c${Number(catalogVersionOf(envState).slice(1)) + 1}`;

/** For each rule, the sub-goals that test it and the scenarios those run in. */
export const ruleCoverageOf = (rules, catalog) => new Map(rules.map((r) => {
  const subGoals = catalog.filter((g) => g.tests?.kind === "rule" && g.tests.ref === r.id);
  const scenarios = [...new Set(subGoals.flatMap((g) => g.usedBy))];
  return [r.id, { subGoals, scenarios }];
}));

/* envModel's `useCaseId`, under a name the hooks lint doesn't read as a hook. */
export const idForUseCase = (text) => stableUseCaseId(text);

/** Every use case a shared check runs in — `refs` when the catalogue has it. */
export const caseRefsOf = (tests) => (tests?.refs?.length ? tests.refs : tests?.ref ? [tests.ref] : []);

/**
 * How much each catalogue entry matters where it's used. The scenario owns
 * that, not the catalogue: the same check can be critical in one scenario and
 * supporting in another.
 */
export const markSplitOf = (env, envState) => {
  const out = new Map();
  (envState?.scenarios || []).forEach((row) => {
    if (row.retired || row.archived) return;
    subGoalsOfScenario(row, env, envState).forEach((x) => {
      const e = out.get(x.id) || { critical: 0, supporting: 0 };
      e[x.mark === "critical" ? "critical" : "supporting"] += 1;
      out.set(x.id, e);
    });
  });
  return out;
};

/* ── sub-goal versions (PRD v7 AC-18.10–18.12) ──────────────────────────────

   Each sub-goal is versioned on its own — greeting@1 → @2 — and never edited
   in place. An edit asks one question first: is it a FIX or a POLICY change?

     fix     a bug in the check, same intent. Publishes @n+1; every scenario
             using it takes a minor bump, so past runs are re-graded from
             stored traces and stay comparable.
     policy  what's right changed. Publishes @n+1 marked `policy`; past runs
             keep @n. Compare reports the sub-goal as "criteria changed",
             outside the headline delta. Scenarios keep their versions.

   Stored as envState.subGoalEdits — [{ id, name, criterion, version (the
   catalogue's cN), at, kind: "fix" | "policy", n, note }]. Entries from
   before v7 carry no kind and read as fixes. */

export const SUBGOAL_EDIT_KINDS = {
  fix: {
    label: "Grader fix",
    short: "Fix",
    ask: "A bug in the check — same intent",
    note: "Scenarios using it move up a minor version; past runs are re-graded from stored traces and stay comparable.",
  },
  policy: {
    label: "Policy change",
    short: "Policy",
    ask: "What's right changed",
    note: "Past runs keep the old version. Compare reports this sub-goal as criteria changed, outside the headline delta; scenarios keep their versions.",
  },
  /* Written by a nudge answer that moved away from a policy change. */
  revert: { label: "Reverted", short: "Revert", ask: "", note: "Back to the earlier criteria." },
};

/** One sub-goal's published versions, oldest first. @1 is the original.
 *  Nudge answers write here too (`policy: true`, `revertOf`); shadows don't count. */
export const subGoalHistoryOf = (envState, id) => (envState?.subGoalEdits || [])
  .filter((e) => e.id === id && !e.shadow)
  .map((e, i) => ({ ...e, n: e.n || i + 2, kind: e.kind || (e.policy ? "policy" : e.revertOf ? "revert" : "fix") }));

/** The version a sub-goal is on: 1 + the versions published since. */
export const subGoalVersionOf = (envState, id) => 1 + subGoalHistoryOf(envState, id).length;

/* "SG-tool-lookup_order" → "lookup_order"; "SG-rule-R3" → "R3". */
const shortOf = (id = "") => id.replace(/^SG-(tool-|rule-)?/, "");

/** "lookup_order@2" — the name a sub-goal version goes by. */
export const subGoalVersionLabel = (envState, id, n = subGoalVersionOf(envState, id)) => `${shortOf(id)}@${n}`;

/** The text a sub-goal quotes from the agent's prompt — the rule it tests, or anything in quotes. */
export const quotedPromptTextOf = (goal, rules = []) => {
  const rule = goal?.tests?.kind === "rule" ? rules.find((r) => r.id === goal.tests.ref) : null;
  if (rule?.text) return rule.text;
  const m = `${goal?.name || ""} ${goal?.criterion || ""}`.match(/["“]([^"”]{6,})["”]/);
  return m ? m[1] : null;
};

/**
 * Publish a sub-goal's next version. → the envState patch: the new edit, the
 * minor bumps a fix makes, and the S version it starts.
 */
export const publishSubGoalPatch = (envState, goal, { name, criterion, kind = "fix", note = "", by = null }) => {
  const n = subGoalVersionOf(envState, goal.id) + 1;
  const label = subGoalVersionLabel(envState, goal.id, n);
  const edit = {
    id: goal.id, name, criterion, kind, n, note: note || null,
    version: nextCatalogVersion(envState), at: new Date().toISOString(), ...(kind === "policy" && { policy: true }),
  };
  const using = new Set(goal.usedBy || []);
  const scenarios = kind === "fix"
    ? (envState?.scenarios || []).map((r) => (using.has(r.id) && !r.archived && !r.retired ? bumpScenario(r, "minor", `Grader fix on ${label}`) : r))
    : envState?.scenarios;
  const bumped = kind === "fix" ? [...using].length : 0;
  return suiteLogPatch(envState, {
    subGoalEdits: [...(envState?.subGoalEdits || []), edit],
    ...(kind === "fix" && { scenarios }),
  }, {
    summary: kind === "fix"
      ? `${label} published as a grader fix — ${bumped} scenario${bumped === 1 ? "" : "s"} re-graded`
      : `${label} published as a policy change — criteria changed`,
    largestBump: kind === "fix" && bumped ? "minor" : null,
    by,
  });
};
