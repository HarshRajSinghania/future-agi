/*
  The pre-computed demo run (Seed Agent, "pre-computed demo run").

  Customer Support Line's second run: the same agent version (v1) on the
  current environment version, with Realistic faults on issue_refund and
  shipment_status. Everything else matches run-voice-1, so Compare shows the
  Tool fidelity row as the one thing that moved, and the run's own results
  carry the fault hits Insights reads.

  Settled the way any finished run is read back — rebuilt from its id and the
  pins it holds — so the numbers on the list, the run page and Compare agree.
*/
import { FAULT_PRESETS } from "./toolEnv";
import { pinsForNewRun } from "./envModel";
import { currentEnvVersion } from "./versions";
import { settledRun } from "./runGroup";

export const DEMO_RUN_ENV = "env-voice-support";
/* A run's outcomes are drawn from its id. This one lands five fault hits on
   the two tools, four of them losing the scenario — enough for Insights to
   have a fault-related cluster and for the pass rate to drop below run 1's —
   while only 8 of 68 go unmeasured, so the drop reads as the agent's. */
export const DEMO_RUN_ID = "run-voice-faults-937";
/* The first demo run (19 of 68 unmeasured); stored copies are swapped out. */
const LEGACY_DEMO_RUN_IDS = ["run-voice-faults-15"];
export const DEMO_FAULT_TOOLS = ["issue_refund", "shipment_status"];

const HOUR = 3600000;

/** The dial the demo run held: Realistic faults on two tools, defaults elsewhere. */
const faultDial = (envState) => {
  const faults = FAULT_PRESETS.realistic.faults;
  const all = { ...(envState?.toolEnv || {}) };
  DEMO_FAULT_TOOLS.forEach((name) => { all[name] = { ...(all[name] || {}), faults, confirmed: true }; });
  return { ...envState, toolEnv: all };
};

/**
 * The finished demo run for this environment's state. Finishes about two
 * hours before `now` — or just after the newest run already there, so it is
 * the latest one either way and its number follows theirs.
 */
export const demoFaultRun = (env, envState, now = Date.now()) => {
  if (!env || !(envState?.scenarios || []).length) return null;
  const runs = (envState.runs || []).filter((r) => !r.pending);
  const newest = runs.reduce((m, r) => Math.max(m, Date.parse(r.finishedAt || r.startedAt || 0) || 0), 0);
  const finishedAt = Math.min(now, Math.max(now - 2 * HOUR, newest + 60000));
  const durationMs = 11 * 60000;
  const ordinal = Math.max(0, ...runs.map((r) => r.ordinal || 0)) + 1;
  const scenarioIds = (envState.runs || []).find((r) => r.id === "run-voice-1")?.scenarioIds
    || envState.scenarios.filter((sc) => !sc.retired && !sc.archived).map((sc) => sc.id);

  const run = {
    id: DEMO_RUN_ID,
    seededAs: "fault-demo",
    ordinal,
    startedAt: new Date(finishedAt - durationMs).toISOString(),
    agentVersion: "v1",
    envVersion: currentEnvVersion(env, envState)?.label || "v1",
    /* Suite, catalogue, evals and caller as they stand; the tool dial with
       the two fault profiles on. */
    ...pinsForNewRun(env, faultDial(envState)),
    evals: envState.evals || [],
    scenarioIds,
    repeats: 3,
    seed: DEMO_RUN_ID,
    partial: false,
    twinWrites: null,
  };
  return { ...settledRun(env, envState, run, new Date(finishedAt)), id: DEMO_RUN_ID };
};

/** Add the demo run to an environment's state — once, newest first. */
export const withDemoFaultRun = (env, envState, now) => {
  if ((envState?.runs || []).some((r) => r.seededAs === "fault-demo" || r.id === DEMO_RUN_ID)) return envState;
  const run = demoFaultRun(env, envState, now);
  return run ? { ...envState, runs: [run, ...(envState.runs || [])] } : envState;
};

/** Swap a stored first demo run for the current one, in place. Absent: nothing. */
export const replaceLegacyDemoRun = (env, envState, now) => {
  const runs = envState?.runs || [];
  const at = runs.findIndex((r) => LEGACY_DEMO_RUN_IDS.includes(r.id));
  if (at < 0 || runs.some((r) => r.id === DEMO_RUN_ID)) return envState;
  const rest = runs.filter((_, i) => i !== at);
  const run = demoFaultRun(env, { ...envState, runs: rest }, now);
  if (!run) return envState;
  const old = runs[at];
  return { ...envState, runs: runs.map((r, i) => (i === at ? { ...run, ordinal: old.ordinal, startedAt: old.startedAt, finishedAt: old.finishedAt } : r)) };
};

/*
  A passing run, so the release gate's Pass shows somewhere out of the box:
  the Returns & refunds line on agent v3, after run 2 — 91% passed with every
  release blocker held, none regressed against run 2. Drawn from its id like
  any run; a stored earlier pick is swapped for it.
*/
export const PASS_RUN_ENV = "env-returns-line";
export const PASS_RUN_ID = "run-returns-line-pass-1270";
/* An earlier pick that passed alone but regressed a blocker against run 2. */
const LEGACY_PASS_RUN_IDS = ["run-returns-line-pass-59"];

export const withPassingRun = (env, envState, now = Date.now(), id = PASS_RUN_ID) => {
  if (!env || !(envState?.scenarios || []).length) return envState;
  envState = { ...envState, runs: (envState.runs || []).filter((r) => !LEGACY_PASS_RUN_IDS.includes(r.id)) };
  const runs = envState.runs.filter((r) => !r.pending);
  if (runs.some((r) => r.seededAs === "pass-demo" || r.id === id)) return envState;
  const tmpl = runs.find((r) => r.agentVersion === "v3") || runs[0];
  if (!tmpl) return envState;
  const newest = runs.reduce((m, r) => Math.max(m, Date.parse(r.finishedAt || r.startedAt || 0) || 0), 0);
  const finishedAt = Math.min(now, Math.max(now - HOUR, newest + 60000));
  const run = {
    id,
    seededAs: "pass-demo",
    ordinal: Math.max(0, ...runs.map((r) => r.ordinal || 0)) + 1,
    startedAt: new Date(finishedAt - 9 * 60000).toISOString(),
    agentVersion: "v3",
    envVersion: tmpl.envVersion,
    ...pinsForNewRun(env, envState),
    evals: tmpl.evals || envState.evals || [],
    scenarioIds: tmpl.scenarioIds,
    repeats: tmpl.repeats || 3,
    seed: id,
    partial: false,
    twinWrites: null,
  };
  const settled = { ...settledRun(env, envState, run, new Date(finishedAt)), id };
  return { ...envState, runs: [settled, ...(envState.runs || [])] };
};
