/**
 * A run group: one agent version, tested in several environments at once.
 *
 * A run is always agent version × environment version, so "run this in three
 * environments" is not one bigger run — it is three runs, started together and
 * read together. Each member is an ordinary run in its own environment (its
 * own row, its own number, its own results); what they share is a `group`
 * stamp naming every member, so any one of them can find the others.
 *
 *   group: { id, agentVersion, members: [{ envId, envName, runId }] }
 *
 * Members are recorded the moment the group starts, as `pending` — the
 * prototype plays a run in the browser, so a member streams when it is opened
 * and is settled (its outcome rebuilt from its id, exactly as a replay would)
 * once any other member of the group finishes.
 */
import { getEnvironment } from "./environments";
import { connectedAgentsFrom, envAgentKey } from "./agentRegistry";
import { agentVersions, currentAgentVersion, currentEnvVersion } from "./versions";
import { currentEnvSnapshot } from "./envSnapshot";
import { runReadiness } from "./setupGaps";
import { protoRunId } from "./executionAdapter";
import { runPlan } from "./proofs";
import { runInputs, toolFit } from "./toolFit";
import { gradedRuleIds } from "./provenance";
import { rebuildRun } from "./comparison";
import { outcomeTally } from "../run/taskOutcome";

/* The same lookup the run page uses, so a member's numbers here match its own page. */
export const envOf = (state, envId) =>
  getEnvironment(envId) || (state?.myEnvironments || []).find((e) => e.id === envId) || null;

/** The name people gave it — an adopted template keeps the user's rename. */
const envNameOf = (state, envId) =>
  (state?.myEnvironments || []).find((e) => e.id === envId)?.name || getEnvironment(envId)?.name || "Environment";

/**
 * The other environments this environment's next run could also run in: every
 * environment testing the same agent (its `usedIn`), each with whether it can
 * run the same agent version right now and, if not, why.
 */
export const groupCandidates = (state, envId) => {
  const es = state?.byEnv?.[envId];
  const key = envAgentKey(es?.agent, envId);
  const version = currentAgentVersion(es)?.label;
  if (!key || !version) return [];
  const agent = connectedAgentsFrom(state).find((a) => a.key === key);
  return (agent?.usedIn || [])
    .filter((u) => u.envId !== envId)
    .map((u) => {
      const other = state.byEnv?.[u.envId];
      const env = envOf(state, u.envId);
      const readiness = runReadiness(other);
      /* Versions are shared by label, so v3 here is v3 there — unless that
         environment has never heard of it (a cache from before sharing). */
      const knows = agentVersions(other).some((v) => v.label === version);
      return {
        envId: u.envId,
        envName: u.envName,
        envVersion: currentEnvVersion(env, other)?.label || null,
        /* Named as that environment's version (a snapshot — envSnapshot.js). */
        envShown: currentEnvSnapshot(env, other)?.label || null,
        ready: readiness.ready && knows,
        reason: !knows ? `Agent ${version} isn't in this environment yet` : readiness.reason,
      };
    });
};

/**
 * The records a new group starts with — one pending run per environment, the
 * environment it was started from first. Nothing is dispatched here.
 */
export const planRunGroup = (state, envId, otherEnvIds, { trials = 3, now = new Date() } = {}) => {
  const stamp = now.getTime().toString(36);
  const agentVersion = currentAgentVersion(state?.byEnv?.[envId])?.label;
  const ids = [envId, ...otherEnvIds.filter((id) => id !== envId)];
  const members = ids.map((id) => ({ envId: id, envName: envNameOf(state, id), runId: protoRunId(id, stamp) }));
  const group = { id: `grp-${stamp}`, agentVersion, members };
  const records = members.map((m) => {
    const es = state?.byEnv?.[m.envId];
    const env = envOf(state, m.envId);
    return {
      envId: m.envId,
      run: {
        id: m.runId,
        label: `${m.envName} · run group`,
        status: "running",
        pending: true,
        startedAt: now.toISOString(),
        total: 0, passed: 0, failed: 0, flaky: 0, unmeasured: 0,
        agentVersion,
        envVersion: currentEnvVersion(env, es)?.label,
        repeats: trials,
        partial: false,
        ordinal: Math.max(0, ...(es?.runs || []).map((r) => r.ordinal || 0)) + 1,
        seed: m.runId,
        twinWrites: null,
        group,
      },
    };
  });
  return { group, records, leader: records[0] };
};

/**
 * A member that never streamed, finished — what it would have recorded had it
 * been watched. Its outcome is rebuilt from its id and the pairing it pinned,
 * the same way every finished run is read back, so opening it later shows
 * these numbers.
 */
export const settledRun = (env, envState, run, now = new Date()) => {
  const plan = runPlan(env, envState, { envVersion: run.envVersion });
  const stamped = {
    ...run,
    scenarioIds: run.scenarioIds || plan.run.map((sc) => sc.id),
    skippedIds: run.skippedIds || plan.skipped.map((sc) => sc.id),
    evals: run.evals || envState?.evals || [],
    rules: run.rules || gradedRuleIds(env, envState),
    actors: run.actors || runInputs(env, envState, { agent: run.agentVersion, envVersion: run.envVersion }).actors.map((a) => a.id),
    toolGap: run.toolGap || toolFit(env, envState, { agent: run.agentVersion, envVersion: run.envVersion }).missing.map((t) => t.name),
  };
  const t = outcomeTally(rebuildRun(env, envState, stamped));
  return {
    ...stamped,
    pending: false,
    label: `${env?.name || "Environment"} · ${t.total} scenario${t.total === 1 ? "" : "s"}`,
    status: t.measured > 0 && t.failed === 0 && !t.flaky ? "passed" : "failed",
    finishedAt: now.toISOString(),
    total: t.total,
    passed: t.passed,
    failed: t.failed,
    flaky: t.flaky,
    unmeasured: t.unmeasured,
  };
};

/** Every member of a run's group with its record as stored now — or null for a run on its own. */
export const groupMembersOf = (state, run) => {
  const members = run?.group?.members;
  if (!members?.length) return null;
  return members.map((m) => {
    const envState = state?.byEnv?.[m.envId];
    return {
      ...m,
      env: envOf(state, m.envId),
      envState,
      run: (envState?.runs || []).find((r) => r.id === m.runId) || null,
    };
  });
};
