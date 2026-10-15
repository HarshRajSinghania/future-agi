/*
  An agent's calls, simulated and real, in one row shape — so the Calls and
  Performance tabs can put them side by side.

    { id, kind: "simulation"|"production", at, version, title, who, where,
      result: passed|failed|flaky|unmeasured, durationS, turns, latencyMs,
      tokens, cost, evals: [{id,name,score,passed}], open: () => drawer data }
*/
import { runSummaries } from "../_mock/comparison";
import { productionCallTask } from "../_mock/observability";
import { taskToVoiceData } from "../_mock/voiceCallData";
import { passShareOf } from "../run/taskOutcome";

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/* Enough history to read from without rebuilding every run ever made. */
const MAX_RUNS = 8;

/** Every scenario call from this agent's finished runs, newest run first. */
export const simulationCallsOf = (runs, state) => {
  const byEnv = new Map();
  const out = [];
  runs.slice(0, MAX_RUNS).forEach((run) => {
    const env = state.myEnvironments.find((e) => e.id === run.envId);
    if (!env) return;
    if (!byEnv.has(env.id)) byEnv.set(env.id, runSummaries(env, state.byEnv[env.id]));
    const full = byEnv.get(env.id).find((x) => x.id === run.id);
    (full?.tasks || []).forEach((task) => {
      const voice = env.surface === "voice";
      out.push({
        id: `${run.id}:${task.id}`,
        kind: "simulation",
        at: run.finishedAt,
        version: run.agentVersion,
        title: task.title || task.name,
        who: task.persona?.name || "Simulated caller",
        where: env.name,
        runLabel: run.label,
        envId: env.id,
        runId: run.id,
        result: task.verdict || task.status,
        /* Share of repeats that passed — how the run screen scores it. */
        passShare: passShareOf(task),
        durationS: Math.round((task.durationMs || 0) / 1000),
        turns: task.steps?.length || 0,
        /* The simulator measures the agent's reply time; stable per call. */
        latencyMs: 380 + (hash(task.id) % 700),
        tokens: task.tokens || 0,
        cost: task.cost || 0,
        evals: task.evalResults || [],
        voice,
        open: () => taskToVoiceData(task, { env, voice }),
      });
    });
  });
  return out;
};

/** Production calls in the same row shape. */
export const productionRowsOf = (calls, agent) => calls.map((c) => ({
  id: c.id,
  kind: "production",
  at: c.at,
  version: c.version,
  title: c.topic,
  who: c.caller,
  where: "Production",
  result: c.passed ? "passed" : "failed",
  failedEvals: c.evals.filter((e) => !e.passed).length,
  status: c.status,
  endedReason: c.endedReason,
  durationS: c.durationS,
  turns: c.turns,
  latencyMs: c.latencyMs,
  tokens: c.tokens,
  cost: c.cost,
  evals: c.evals,
  voice: true,
  open: () => ({
    ...taskToVoiceData(productionCallTask(c, agent), { voice: true }),
    module: "observe",
    provider: agent?.values?.provider || "production",
    call_metadata: { provider: agent?.values?.provider || "production", call_direction: "inbound" },
    call_type: "inbound",
    phone_number: c.caller,
    timestamp: c.at,
    ended_reason: c.endedReason,
  }),
}));

/**
 * Per-eval pass rate over a set of calls: { [evalId]: { name, rate, n } }.
 * A call counts toward an eval only if it was graded on it.
 */
export const evalRates = (rows) => {
  const out = {};
  rows.forEach((r) => (r.evals || []).forEach((e) => {
    const s = (out[e.id] ||= { id: e.id, name: e.name, color: e.color, passed: 0, n: 0 });
    s.n += 1;
    if (e.passed) s.passed += 1;
  }));
  Object.values(out).forEach((s) => { s.rate = s.n ? Math.round((s.passed / s.n) * 100) : null; });
  return out;
};

export const fmtDuration = (s) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
export const fmtCost = (c) => (c ? `$${c < 0.1 ? c.toFixed(3) : c.toFixed(2)}` : "—");
export const fmtTokens = (t) => (t ? (t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t)) : "—");
