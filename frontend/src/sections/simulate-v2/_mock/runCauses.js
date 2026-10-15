/*
  Verdict causes for one run's results (PRD v7 §4.10.10 · AC-12.19–12.25).

  Every screen that shows a run's results — the Scenarios tab, the scenario
  drawer, Insights, the shared report, the digest — reads each scenario's
  verdict and cause from here, so they cannot disagree.

    · N/A — the scenario isn't applicable to the run's agent version (an
      approved Remove nudge, `applicabilityOf`). Outside every count.
    · canary — an impossible-scenario canary that held. Outside the pass
      rate; it only ever counts as a cheat check (AC-12.25).
    · exploration — an exploration-tier scenario, or a proposed candidate
      that hasn't joined S yet (§4.10.9). Carries its cause like any other,
      but its results show separately, outside the main rates.
    · pulled — test invalid twice on a run with the updated RSI PRD's
      outcomes: taken out of the run and flagged for review. Outside every
      count, listed on its own.
    · stale — the scenario was Outdated or Re-check when the run started
      (`run.staleScenarios`, pinned on new runs). It ran and carries its
      cause, but counts toward no decision until updated or archived.
    · otherwise `causeOf(task, { missingCaps })`, where missingCaps are the
      capabilities the scenario is tagged as needing that this agent
      version's manifest lacks. Only applied after a fail.

  Every verdict carries its outcome — passed · failed · inconclusive ·
  test-invalid · error — with the v7 cause as the detail under it.
*/
import { OUTCOMES, VERDICT_CAUSES, applicabilityOf, causeOf, manifestOf, outcomeOfCause, requiredCapsOf } from "./decoupled";
import { tierOf } from "./tiers";
import { scenarioStateFor } from "./scenarioStates";
import { knownToolsFor, requiredToolsOf } from "./toolFit";

/** The order causes are listed in, everywhere — grouped by outcome. */
export const CAUSE_ORDER = [
  "pass",
  "fail-agent", "fail-required", "fail-capability", "fail-cheat",
  "inc-evidence",
  "inc-simulator", "inc-setup", "inc-judge",
  "inc-infra", "inc-transport",
];

/** Short labels for tight places — "agent", "capability-missing", "simulator". */
export const causeShort = (cause) => (VERDICT_CAUSES[cause]?.label || cause).replace(/^(passed|failed|inconclusive|test invalid|error) · /i, "");

/** "Test invalid", "Error" — the outcome a cause rolls up to, as a label. */
export const outcomeLabelOf = (cause) => OUTCOMES[outcomeOfCause(cause)]?.label || "Inconclusive";

/**
 * The scenarios that were Outdated or Re-check as a run starts — they still
 * run, but count toward no decision until updated or archived. Pinned on the
 * new run as `staleScenarios` ({ id: "outdated" | "recheck" }), so a later
 * rewrite doesn't change what an old run counted. Null when none are.
 */
export const staleScenariosOf = (env, envState, rows = []) => {
  const known = knownToolsFor(env, envState);
  const out = {};
  rows.forEach((r) => {
    const st = scenarioStateFor(r, { id: "proved" }, { env, envState, tools: requiredToolsOf(r, known) });
    if (st.id === "outdated" || st.id === "recheck") out[r.id] = st.id;
  });
  return Object.keys(out).length ? out : null;
};

export const STALE_LABEL = { outdated: "Outdated", recheck: "Re-check" };

export const CHEAT_SIGNALS = {
  "forbidden-tool": "Forbidden tool",
  canary: "Impossible-scenario canary",
  manipulation: "Grader or simulator manipulation",
  "out-of-bounds": "Out-of-bounds access",
};

/**
 * Each task's verdict, by id:
 * { na, naReason, capability } | { canary, label } | { pulled, reason, label } |
 * { cause, outcome, label, scored, missing[], cheat?, suspected?, required?,
 *   retried?, stale? }
 */
export const taskVerdictsOf = ({ env, envState, run, tasks = [] }) => {
  const agent = run?.agentVersion || null;
  const have = new Set(manifestOf(env, envState, agent).tools);
  const rows = new Map((envState?.scenarios || []).map((r) => [r.id, r]));
  const stale = run?.staleScenarios || {};
  const out = new Map();
  tasks.forEach((t) => {
    /* Test invalid twice — taken out of the run, flagged for review. */
    if (t.pulled) {
      out.set(t.id, {
        pulled: true, label: "Pulled for review", outcome: "test-invalid", cause: causeOf(t), reason: t.pulled.reason, retried: t.retried || null,
      });
      return;
    }
    const row = rows.get(t.id) || rows.get(t.scenarioId) || t;
    const app = agent ? applicabilityOf(row, agent, env, envState) : { applies: true };
    if (!app.applies) {
      out.set(t.id, { na: true, label: "N/A", capability: app.capability, naReason: app.reason || "Not applicable to this agent version" });
      return;
    }
    if ((row.canary || t.canary) && !t.cheat) {
      out.set(t.id, {
        canary: true,
        checked: !!t.canary,
        label: t.canary ? "canary · held" : "canary · not checked",
      });
      return;
    }
    /* The label is applied only after a fail (AC-12.20). */
    const failed = t.status !== "passed" && t.status !== "unmeasured" && t.measured !== false;
    const missing = failed && !t.cheat ? requiredCapsOf(row, env, envState).filter((c) => !have.has(c)) : [];
    const cause = causeOf(t, { missingCaps: missing });
    const candidate = !!row.proposed;
    out.set(t.id, {
      cause,
      outcome: outcomeOfCause(cause),
      ...((candidate || tierOf(row) === "exploration") && { exploration: true, candidate }),
      label: VERDICT_CAUSES[cause].label,
      scored: VERDICT_CAUSES[cause].scored,
      missing,
      ...(t.cheat && { cheat: t.cheat }),
      ...(t.suspected && { suspected: t.suspected }),
      ...(cause === "fail-required" && t.requiredFail && { required: t.requiredFail }),
      ...(t.retried && { retried: t.retried }),
      ...(stale[t.id] && { stale: stale[t.id] }),
      /* Stopped at the turn limit (runs that pinned `turnLimits`). */
      ...(t.turnLimit && failed && { turnLimit: t.turnLimit }),
    });
  });
  return out;
};

/** What a scenario's verdict reads as in one line — "fail · capability-missing (refund_order)". */
export const verdictLineOf = (v) => {
  if (!v) return null;
  if (v.na) return `N/A — ${v.naReason}`;
  if (v.canary) return v.checked ? "Canary held — an impossible scenario the agent didn't fake" : "Canary — this run wasn't checked for cheating";
  if (v.pulled) return v.reason;
  if (v.cause === "fail-required") return `Failed a required evaluation · ${v.required?.name || "required evaluation"}`;
  if (v.cause === "fail-capability") return `${v.label} (${v.missing.join(", ")})`;
  if (v.cause === "fail-cheat") return `${v.label} — ${v.cheat?.label || "shortcut"}`;
  if (v.turnLimit) return `${v.label} — Hit the turn limit (${v.turnLimit.limit})`;
  return v.label;
};
