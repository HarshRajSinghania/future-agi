import { useCallback } from "react";
import { useConnectedAgents } from "../../store";
import { agentIdOf, agentRecordFromSource } from "../../_mock/agentRegistry";

/**
 * Saves what a connect flow finished with as an agent in Agents — the New
 * agent page and an issue's Connect agent to fix alike. One already in
 * Agents (same repository, platform ID or endpoint) gains what the form
 * added; it never becomes a second record or a new version.
 *
 * Returns { id, name, exists }.
 */
export const useSaveConnectedAgent = () => {
  const { agents, connectAgent } = useConnectedAgents();
  return useCallback((source) => {
    const now = new Date().toISOString();
    const built = agentRecordFromSource(source, now);
    /* An Observe project settled at connect (from an issue) isn't asked again. */
    const record = source.observeChosenAt ? { ...built, values: { ...(built.values || {}), observeChosenAt: source.observeChosenAt } } : built;
    const exists = agents.some((a) => a.key === record.key);
    connectAgent(exists ? record : {
      ...record,
      /* Connected in one step — the agent's page walks through the rest. */
      values: { ...(record.values || {}), setupStartedAt: now },
      versions: [{ id: "agent-v1", label: "v1", note: source.versionNote || "First version connected.", createdAt: now, connectedAt: now, origin: "connect" }],
    });
    return { id: agentIdOf(record.key), name: record.name, exists };
  }, [agents, connectAgent]);
};
