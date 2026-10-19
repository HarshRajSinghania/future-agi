/*
  A finished run, read as one record: its summary, what it metered, the digest
  it sent and the report it can be shared as. Every surface that shows a
  finished run — the run page header, Insights, the shared report, the digest
  posted at completion — reads it from here, so they cannot disagree.
*/
import { resolveEval } from "./evals";
import { replicationOf } from "./replication";
import { meteredOfRun, meterLine, DIMENSIONS } from "./metering";
import { runInsightsOf } from "./runInsights";
import { runRollupOf, baselineFor, suiteSizeOf } from "./runRollup";
import { runDigestOf, digestDestinationsOf } from "./runDigest";
import { runIdentityOf } from "./runIdentity";

/*
  One task is one scenario played `repeats` times; metering is per call. So a
  scenario is expanded into its calls before metering — the same unit the
  estimate on the Run button quotes (scenarios × repeats). A scenario that
  wasn't measured stays one row and meters nothing.
*/
const callsOf = (tasks = []) => tasks.flatMap((t) => {
  if (t.status === "unmeasured" || t.measured === false) return [{ ...t, status: "unmeasured" }];
  const n = Math.max(1, t.repeats || 1);
  return Array.from({ length: n }, () => t);
});

/** A customer's own sandbox endpoint — recorded `daytona-byo`, meters zero. */
export const byoSandboxOf = (agent) => !!(agent?.values?.byoSandbox || agent?.values?.sandboxEndpoint);

/**
 * What a finished run metered (AC-16.9).
 * { lines, usd, line, excluded, runLocation, byo, evals, notes[] }
 */
export const runMeteringOf = ({ env, envState, run, tasks = [] }) => {
  /* The graders that applied when it ran — the same list RunResults reads,
     falling back to the environment's current ones for older records. */
  const evals = (run?.evals || envState?.evals || []).map(resolveEval).filter(Boolean);
  const agent = envState?.agent || null;
  const runLocation = agent ? replicationOf(agent, env).runLocation : null;
  const byo = runLocation === "hosted" && byoSandboxOf(agent);
  const metered = meteredOfRun({ env, tasks: callsOf(tasks), evals, runLocation, byoSandbox: byo });
  const notes = [];
  if (metered.excluded) {
    notes.push(`${metered.excluded} ${metered.excluded === 1 ? "scenario" : "scenarios"} that didn't count — not charged`);
  }
  /* Cost the agent's side didn't report is unverified — never read as $0. */
  const unverified = tasks.filter((t) => t.costUnverified && t.status !== "unmeasured" && t.measured !== false).length;
  if (unverified) notes.push(`${unverified} ${unverified === 1 ? "scenario" : "scenarios"} didn't report cost — unverified`);
  if (byo) notes.push("Ran on your own sandbox — no sandbox minutes charged");
  const judged = evals.filter((e) => /LLM judge/i.test(String(e.type || "")) && !e.byok);
  return {
    ...metered,
    line: meterLine(metered),
    runLocation,
    byo,
    evals,
    judged: judged.map((e) => e.name),
    notes,
    /* Per-dimension detail for the tooltip. */
    detail: metered.lines.map((l) => ({
      label: DIMENSIONS[l.dimension]?.label || l.dimension,
      amount: l.byo ? "0 (your sandbox)" : `${l.amount.toLocaleString()} ${DIMENSIONS[l.dimension]?.unit || ""}`.trim(),
      usd: l.usd == null ? (l.amount ? "rate TBD" : "$0") : `$${l.usd.toFixed(2)}`,
    })),
  };
};

/**
 * Everything a finished run is read as.
 * `summaries` are the env's run summaries (runSummaries) — passed in because
 * the run page already has them; `tasks` override the rebuilt ones when the
 * caller has them live.
 */
export const runReportOf = ({
  env, envState, runId, tasks, summaries = [], goalOf, integrations, insights: given,
}) => {
  const identity = summaries.find((r) => r.id === runId) || null;
  const list = tasks || identity?.tasks || [];
  const run = identity
    ? { ...identity, tasks: list }
    : {
      id: runId,
      tasks: list,
      cost: list.reduce((a, t) => a + (t.cost || 0), 0),
      avgDurationMs: list.length ? Math.round(list.reduce((a, t) => a + (t.durationMs || 0), 0) / list.length) : 0,
    };
  const baseline = baselineFor(summaries, runId, envState);
  /* A report, not a verdict: pass^1 / pass^k, counts by outcome and cause.
     It never blocks, promotes or ships anything (T58). */
  const summary = runRollupOf(run, { env, envState, scenarioCount: suiteSizeOf(envState) });
  const insights = given || runInsightsOf({ tasks: list, env, envState, run: identity || { id: runId }, goalOf });
  const metering = runMeteringOf({ env, envState, run: identity, tasks: list });
  const destinations = digestDestinationsOf(integrations);
  const named = identity ? runIdentityOf(identity, envState, env) : null;
  const digest = runDigestOf({ env, run: identity || { id: runId }, insights, summary, label: named ? `${named.label} · ${env?.name}` : env?.name });
  return { identity, run, baseline, summary, insights, metering, destinations, digest };
};
