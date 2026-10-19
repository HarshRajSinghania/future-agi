/*
  Where an environment's world comes from, when it isn't read from the agent.

  Every environment belongs to exactly one agent in Agents (RSI PRD: "From
  Phase 1, each environment belongs to exactly one agent in Agents"). A
  prebuilt world, an MCP server or a SaaS sandbox is never an environment on
  its own — it's the world source of one agent's build: the agent is picked
  (or connected) first, and the world seeds what the builder makes for it.

  Kept out of the .jsx files so they export components only.
*/
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { paths } from "src/routes/paths";
import { buildPresetFor } from "../agents/agentViewUtils";
import { agentStatusOf, isComingSoon } from "../_mock/rsiModel";
import { worldFromTemplate } from "../_mock/agentWorlds";

/**
 * The agents an environment can be built for: in Agents (not a template's
 * stand-in), connected (not archived or cut off), and not Coming soon.
 */
export const buildableAgentsOf = (agents = []) => agents.filter(
  (a) => !a.placeholder && !isComingSoon(a) && agentStatusOf(a).status === "connected",
);

/** The host an MCP server is reached at — or the command, for stdio. */
export const mcpHostOf = (value = "") => {
  const first = String(value).trim().split(/\s+/)[0];
  try { return new URL(first).hostname; } catch { return first; }
};

/** A prebuilt world as the world an agent's environment starts from. */
export const templateWorldSource = (template) => ({
  kind: "template",
  id: template.id,
  label: template.name,
  world: worldFromTemplate(template),
});

/** An MCP server as the world an agent's environment starts from. */
export const mcpWorldSource = ({ transport, value, tokenRef }) => ({
  kind: "mcp",
  label: mcpHostOf(value),
  transport,
  value,
  ...(tokenRef && { tokenRef }),
});

/**
 * Build an environment for an agent, as the agent page does — the name,
 * version and size picked in BuildEnvironmentDialog — optionally starting
 * from a world source.
 */
export function useBuildForAgent() {
  const navigate = useNavigate();
  return useCallback((agent, choice, worldSource = null) => navigate(paths.dashboard.simulate.environmentBuild, {
    state: { presetSource: { ...buildPresetFor(agent, choice), ...(worldSource && { worldSource }) } },
  }), [navigate]);
}
