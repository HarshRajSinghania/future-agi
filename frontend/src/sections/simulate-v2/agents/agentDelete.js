/*
  Deleting an agent (RSI PRD, Agents → Lifecycle): "possible only once the
  agent has no environments left." Until then Delete is disabled and says
  why — delete its environments first, or archive it instead (an
  environment never moves to another agent).
*/
import { plural } from "./agentViewUtils";

/** Null when the agent can be deleted; otherwise the reason it can't. */
export const deleteBlockOf = (agent) => {
  const n = agent?.usedIn?.length || 0;
  if (!n) return null;
  return `${agent.name} still has ${plural(n, "environment")}. Delete ${n === 1 ? "it" : "them"} first, or archive the agent.`;
};

export const canDeleteAgent = (agent) => !deleteBlockOf(agent);
