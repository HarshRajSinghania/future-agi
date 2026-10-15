/*
  Error Feed → Fix. Everything the Fix button needs, mocked.

  A Fix starts an improvement run scoped to one issue: scenarios are built
  from the issue's traces and added to the agent's environment, the failure
  is reproduced first, then the usual search runs. The issue's chip on the
  Error Feed reads its state back from that improvement run, its hand-off
  and the environment's releases — there is no separate "fix" record to
  drift out of step.

  The pure parts live in issueFixModel.js (the seed builds its fixes from
  them); this file adds the hook and re-exports the rest.
*/
import { useCallback, useMemo } from "react";
import { useSimStore, useConnectedAgents } from "../store";
import { limitsOf } from "../agents/agentLimits";
import { useIntegrations } from "../_mock/integrations";
import { observabilityOf } from "../_mock/observability";
import { rereadFor } from "../_mock/improvementPolicy";
import { addImprovementScenariosPatch } from "../_mock/improvementScenarios";
import {
  agentKeyForIssue, envsForAgent, evidenceGateOf, fixGateOf, fixStatusOf, issueFixRecord, issueProjectLinkOf, issueProjectOf,
} from "./issueFixModel";

export * from "./issueFixModel";

/** The issue's fix state plus the actions the Error Feed needs. */
export function useIssueFix(issue) {
  const { state, commit } = useSimStore();
  const { agents } = useConnectedAgents();
  const { prs } = useIntegrations();
  const issueId = issue?.cluster_id;
  const agentKey = agentKeyForIssue(issue, state, agents);
  const agent = useMemo(() => agents.find((a) => a.key === agentKey) || null, [agents, agentKey]);
  /* Fix needs the agent's production traces: the scenarios are built from
     them and the watch after release reads them. */
  /* Its traces exist when the agent's calls are watched — or when this very
     issue came from an Observe project linked to the agent: the issue is
     built from those production traces. */
  const fromLinkedProject = !!agent && issueProjectLinkOf(issue, state, agents).agentKey === agent.key;
  const tracing = agent ? observabilityOf(agent).on || fromLinkedProject : null;
  const status = useMemo(() => (issueId ? fixStatusOf(issue, state, prs || []) : null), [issue, issueId, state, prs]);

  /* The issue's Observe project — its agent was set when the project was. */
  const project = issueProjectOf(issue);

  /*
    Start: an improvement run is written against the environment's newest
    run, on its scenarios plus the issue's. The issue's scenarios — the ones
    picked on the Fix sheet — are added to the agent's main environment as
    it starts (RSI PRD: the fix runs in the main environment; new scenarios
    make a new version), so the failure is tested where its must-pass set is
    the regression check, and stays covered after the fix ships. It
    re-reads the agent first — a change made outside Future AGI is saved as a
    version and becomes the baseline — then reproduces; when the failure
    doesn't happen, the run stops there and keeps the search it would have
    run for "Continue anyway".
  */
  /* Fix runs Future AGI's engine. A customer's own coding agent comes in
     through Copy for coding agent instead (RSI PRD, Flow 6). */
  const start = useCallback(({ env, drafts, regressionEnvIds, budget, minutes, textSearch, targetMember, rootCause }) => {
    const es = state.byEnv[env.id];
    const reread = rereadFor(agent, state);
    if (reread?.changed && reread.versionRecord && agentKey) {
      commit({ type: "recordAgentVersion", key: agentKey, version: reread.versionRecord, activateEnvId: env.id });
    }
    /* The time budget the sheet set caps the search the same way dollars do. */
    const limits = limitsOf(state, agentKey);
    const record = issueFixRecord({
      issue, env, es, drafts, budget, regressionEnvIds, state, reread, textSearch, targetMember, rootCause,
      limits: minutes ? { ...limits, budget: { ...limits.budget, minutes } } : limits,
    });
    /* Saved now — Start fix leaves the Error Feed straight after. */
    const optimizations = [...(es?.optimizations || []), record];
    commit({
      type: "patchEnvState",
      envId: env.id,
      patch: { optimizations, ...addImprovementScenariosPatch({ ...es, optimizations }, record) },
    });
    return { envId: env.id, runId: record.fromRunId, optId: record.id };
  }, [state, commit, issue, agentKey, agent]);

  /* Why Fix can't start, if it can't — said on the button and the sheet. */
  const gate = useMemo(() => (agent ? fixGateOf(agent, envsForAgent(agent, state)[0]) : null), [agent, state]);
  /* Fix starts on confirmed issues only. */
  const evidence = useMemo(() => evidenceGateOf(issue), [issue]);

  return { state, agent, agentKey, agents, project, tracing, status, gate, evidence, start };
}
