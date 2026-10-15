/*
  Simulate → Agent definitions, moved into Agents (updated RSI PRD:
  "existing records move in; old links redirect to the agent page").

  The old list comes from the backend (`/simulate/agent-definitions/`). Each
  definition becomes a Connected agent once someone brings it in: one record
  per definition, keyed by its old id so bringing it in twice lands on the
  same row and an old `agent-definitions/:id` link finds it.

  With no backend to answer (this prototype on its own), a small sample
  stands in so the move can still be shown.
*/
import { languageMap } from "src/components/agent-definitions/helper";
import { agentRecordFromSource, agentIdOf } from "../_mock/agentRegistry";

/* Platforms the old form offered that Agents imports by API key. */
const HOSTED = new Set(["vapi", "retell", "bland", "elevenlabs"]);

export const LEGACY_SAMPLE = [
  {
    id: "legacy-def-claims",
    agent_name: "Claims hotline (old definition)",
    agent_type: "voice",
    provider: "vapi",
    contact_number: "+1 415 555 0142",
    inbound: true,
    languages: ["en", "es"],
    description: "Takes first notice of loss for home claims and books an adjuster.",
    latest_version: "v3",
  },
  {
    id: "legacy-def-orders",
    agent_name: "Order status chat (old definition)",
    agent_type: "chat",
    provider: "others",
    languages: ["en"],
    description: "Answers where-is-my-order questions from the help centre widget.",
    latest_version: "v1",
  },
];

export const legacyKeyOf = (def) => `legacy:${def.id}`;

/** Language codes ("en") → names ("English"), the way Agents stores them. */
const languagesOf = (def) => (Array.isArray(def.languages) ? def.languages : [])
  .map((l) => languageMap[l] || l)
  .filter(Boolean);

/** The Connected agent a legacy definition becomes. */
export const legacyRecordOf = (def, now = new Date().toISOString()) => {
  const provider = String(def.provider || "").toLowerCase();
  const voice = def.agent_type !== "chat";
  const assistantId = def.assistant_id || def.assistantId || "";
  const hosted = HOSTED.has(provider);
  const source = hosted
    ? {
      kind: "platform", provider, agentType: voice ? "voice" : "chat",
      ...(assistantId ? { agentId: assistantId } : { agentMode: "prompt", prompt: def.description || "" }),
      ...(def.contact_number && { contact: { mode: "phone", number: def.contact_number } }),
      callDirection: def.inbound === false ? "outbound" : "inbound",
    }
    : def.contact_number
      ? { kind: "endpoint", phone: true, phoneNumber: def.contact_number, systemPrompt: def.description || "" }
      : { kind: "platform", provider: "other", agentType: voice ? "voice" : "chat", agentMode: "prompt", prompt: def.description || "" };
  const base = agentRecordFromSource({
    ...source,
    name: def.agent_name,
    languages: languagesOf(def),
    /* An old definition's "description" held its system prompt — it's the
       prompt above, not a line to show under the agent's name. */
    channels: [voice ? "voice" : "chat"],
  }, now);
  const key = legacyKeyOf(def);
  return {
    ...base,
    key,
    values: { ...base.values, movedFrom: { kind: "agent-definition", id: def.id, version: def.latest_version || null, at: now } },
    versions: [{
      id: "agent-v1", label: "v1", createdAt: now, connectedAt: now, origin: "moved",
      note: `Moved from Simulate → Agent definitions${def.latest_version ? ` (was ${def.latest_version})` : ""}.`,
    }],
  };
};

/** The Connected agents id an old definition maps to, once brought in. */
export const legacyAgentIdOf = (def) => agentIdOf(legacyKeyOf(def));
