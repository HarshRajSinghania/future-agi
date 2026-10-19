import { useNavigate } from "react-router-dom";
import { paths } from "src/routes/paths";
import { useSimStore } from "../store";
import {
  twinById, seedScenariosForClone, resolveSeedPromptToJson,
} from "../_mock/twins";
import { agentPinPatch } from "../_mock/versions";
import { currentUser, stampProvenance } from "../_mock/scenarioProvenance";

/**
 * Creates an agent's environment on a SaaS sandbox and navigates to it.
 *
 * Every environment belongs to exactly one agent in Agents (RSI PRD), so
 * `agent` is a connected agent (useConnectedAgents) — never a raw endpoint.
 * Its record, versions and identity are attached the way the builder
 * attaches them, following the version in production. The sandbox is kept
 * until the environment is deleted; nothing expires.
 */
export function useCreateTwinEnv() {
  const navigate = useNavigate();
  const { dispatch } = useSimStore();

  return (services, {
    name = "",
    seedPrompt = "",
    agent = null,
  } = {}) => {
    if (!services?.length || !agent) return null;

    const envId = `env-twin-${Date.now().toString(36)}`;
    const resolvedSeed = resolveSeedPromptToJson(services, seedPrompt.trim());
    const derivedName = name.trim() || defaultEnvName(services);
    /* Full seed pack: starter-per-service + cross-service combos,
       each pre-stamped with a persona so the Personas tab is populated
       from the moment the env lands. */
    const provisionedAt = new Date().toISOString();
    /* One batch — built by you, just now. Unstamped rows would get the demo
       back-fill (teammates, days ago), which a sandbox built seconds ago
       can't have. */
    const starterScenarios = seedScenariosForClone(services)
      .map((sc) => stampProvenance(sc, { source: "derived", actor: currentUser(), at: provisionedAt, batchId: `batch_build_${envId}` }));
    const twinBacking = {
      services,
      seedPrompt: seedPrompt.trim(),
      seed: resolvedSeed,
      endpoints: Object.fromEntries(services.map((sId) => [
        sId,
        `https://${sId}.sandbox.futureagi.com/e/${envId.slice(-6)}`,
      ])),
      activity: Object.fromEntries(services.map((sId) => [sId, { requests: 0, failures: 0 }])),
      provisionedAt,
      /*
        status: "provisioning" while the inline TwinProvisioningView
        is animating; the view flips it to "ready" once every phase
        lands, which unlocks the real review layout.
      */
      status: "provisioning",
    };

    const env = {
      id: envId,
      agentType: "twin_backed",
      name: derivedName,
      surface: primarySurface(services),
      domain: "twin",
      tagline: `${services.length} sandboxed app${services.length === 1 ? "" : "s"}`,
      description: seedPrompt.trim() || defaultDescription(services),
      difficulty: "Advanced",
      popularity: 1,
      builtFrom: { kind: "twin", services },
      seed: { tables: [] },
      tools: [],
      rules: [],
      evalPreset: ["task_success", "twin_end_state_match", "twin_no_extra_writes"],
      buildStatus: "ready",
      buildProgress: { done: 3, total: 3 },
      starterScenarios,
    };

    /* The agent from Agents, as the builder attaches it: its record and
       versions, tested at the version in production. */
    // eslint-disable-next-line no-unused-vars
    const { versions, usedIn, latest, id: _agentId, ...record } = agent;
    const version = agent.production || latest || "v1";
    dispatch({ type: "adoptEnvironment", env, now: provisionedAt });
    dispatch({
      type: "patchEnvState",
      envId,
      patch: {
        twinBacking,
        scenarios: starterScenarios,
        scenarioSource: "twin_starter",
        agent: { ...record, connectedAt: record.connectedAt || provisionedAt },
        ...(versions?.length && { agentVersions: versions }),
        ...agentPinPatch({ agent: record, agentVersions: versions || [] }, version),
      },
    });
    /* Land on the review layout (chat left + workspace tabs right). */
    navigate(paths.dashboard.simulate.environmentTwinReview(envId));
    return envId;
  };
}

/* ── helpers (kept here so both consumers get identical defaults) ── */

export function defaultEnvName(services) {
  if (services.length === 1) {
    const t = twinById(services[0]);
    return t ? `${t.name} sandbox` : "SaaS sandbox";
  }
  return `${services.length}-app sandbox`;
}

export function defaultDescription(services) {
  const names = services.map((s) => twinById(s)?.name).filter(Boolean).join(", ");
  return `SaaS sandbox. The agent works across ${names || "the selected apps"}.`;
}

export function primarySurface(services) {
  if (services.some((s) => ["slack", "gmail", "discord"].includes(s))) return "chat";
  if (services.some((s) => ["github", "linear"].includes(s))) return "coding";
  return "chat";
}
