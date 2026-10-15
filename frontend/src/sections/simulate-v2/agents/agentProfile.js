/*
  Who an agent is and how it's reached, read the same way on the agent page,
  the Connected agents list and anywhere else that names it (updated RSI PRD,
  "Agents, defined"). Every field is optional on the stored record — the
  connect step writes most of them — and each reader derives a default, so
  agents saved before a field existed read sensibly without a re-seed.

  Stored on the agent's values:
    values.owner          "Priya Shah"
    values.languages      ["English", "Spanish"]
    values.description    one line
    values.reach          { maxConcurrent, whoSpeaksFirst, direction, turnLimit, whoWritesFirst }
    values.channels       ["voice", "chat"]                     (agentLifecycle.js)
    values.retellKind     "single_prompt" | "conversation_flow"
    values.fagiPrompts    [{ promptId, name, version }]
    values.gitHost        "github" (GitLab and Bitbucket later)
    values.activeVersion  { label, at, by } — a built-in agent's released version
*/
import { currentUser } from "../_mock/scenarioProvenance";
import { PROVIDER_LABELS, definitionOf, sourceKindOf } from "../_mock/agentRegistry";
import { agentChannelsOf } from "../_mock/agentLifecycle";

const hash = (s) => {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i += 1) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/* ── identity ─────────────────────────────────────────────────────────────── */

export const LANGUAGES = [
  "English", "Spanish", "French", "German", "Portuguese", "Italian", "Dutch",
  "Hindi", "Japanese", "Mandarin", "Korean", "Arabic",
];

/**
 * { owner, ownerSet, languages, description } — the owner defaults to whoever
 * connected it (one user in this workspace), languages to English.
 */
export const identityOf = (agent) => {
  const v = agent?.values || {};
  const owner = typeof v.owner === "string" && v.owner.trim() ? v.owner.trim() : null;
  const languages = Array.isArray(v.languages) && v.languages.length ? v.languages : ["English"];
  return {
    owner: owner || currentUser().name,
    ownerSet: !!owner,
    languages,
    languagesSet: Array.isArray(v.languages) && v.languages.length > 0,
    description: typeof v.description === "string" ? v.description.trim() : "",
  };
};

/** "English, Spanish" — or "English +2" when space is short. */
export const languagesLabel = (languages, max = 3) => {
  const list = languages || [];
  return list.length > max ? `${list.slice(0, max).join(", ")} +${list.length - max}` : list.join(", ");
};

/* ── reach ────────────────────────────────────────────────────────────────── */

export const MAX_CONCURRENT_STEPS = [1, 2, 5, 10, 20, 50, 100];
/* 0 means no limit. */
export const TURN_LIMIT_STEPS = [10, 20, 30, 50, 0];
export const DIRECTIONS = [
  { id: "inbound", label: "Inbound", body: "The simulator calls the agent, like a customer would." },
  { id: "outbound", label: "Outbound", body: "The agent places the call; the simulator answers." },
  { id: "both", label: "Both", body: "It takes calls and places them — scenarios say which." },
];

/* The connect step may write "user", "caller" or "customer" for the person. */
const isAgentSide = (s) => s === "agent" || s === "assistant" || s === "bot";

/**
 * Reach, normalised: direction, who speaks first and calls at once for voice;
 * who writes first and the turn limit for chat. Old saves read their call
 * settings (`contact`, `callDirection`) so nothing changes until edited.
 */
export const reachOf = (agent) => {
  const v = agent?.values || {};
  const r = v.reach || {};
  const c = v.contact || {};
  const legacyDirection = c.inboundCalls === false || v.callDirection === "outbound" ? "outbound" : "inbound";
  const direction = ["inbound", "outbound", "both"].includes(r.direction) ? r.direction : legacyDirection;
  const whoSpeaksFirst = r.whoSpeaksFirst ? (isAgentSide(r.whoSpeaksFirst) ? "agent" : "user") : c.agentSpeaksFirst ? "agent" : "user";
  const whoWritesFirst = r.whoWritesFirst ? (isAgentSide(r.whoWritesFirst) ? "agent" : "user") : "user";
  const voice = agentChannelsOf(agent).includes("voice");
  const maxConcurrent = Number.isFinite(Number(r.maxConcurrent)) && Number(r.maxConcurrent) > 0
    ? Number(r.maxConcurrent)
    : voice ? 10 : 25;
  const turnLimit = r.turnLimit === 0 || r.turnLimit === null ? 0
    : Number.isFinite(Number(r.turnLimit)) && Number(r.turnLimit) > 0 ? Number(r.turnLimit) : 30;
  return { direction, whoSpeaksFirst, whoWritesFirst, maxConcurrent, turnLimit };
};

/**
 * The values patch for a reach change — `reach` itself, plus the call
 * settings older readers still look at (the Connection rows, the run's
 * caller), kept in step.
 */
export const reachPatch = (agent, patch) => {
  const reach = { ...reachOf(agent), ...(agent?.values?.reach || {}), ...patch };
  const out = { reach };
  if (patch.direction) {
    out.callDirection = patch.direction === "outbound" ? "outbound" : "inbound";
    out.contact = { ...(agent?.values?.contact || {}), inboundCalls: patch.direction !== "outbound" };
  }
  if (patch.whoSpeaksFirst) {
    out.contact = { ...(out.contact || agent?.values?.contact || {}), agentSpeaksFirst: patch.whoSpeaksFirst === "agent" };
  }
  return out;
};

export const turnLimitLabel = (n) => (n ? `${n} turns` : "No limit");

/* ── Retell kind ──────────────────────────────────────────────────────────── */

export const RETELL_KINDS = {
  single_prompt: { label: "Single prompt", note: "One prompt runs the whole call." },
  conversation_flow: { label: "Conversation flow", note: "A flow of nodes, each with its own prompt and transitions." },
};

/** Retell agents only — the kind recorded at connect, else single prompt. */
export const retellKindOf = (agent) => {
  if (agent?.values?.provider !== "retell") return null;
  const id = RETELL_KINDS[agent.values.retellKind] ? agent.values.retellKind : "single_prompt";
  return { id, ...RETELL_KINDS[id], recorded: !!RETELL_KINDS[agent.values.retellKind] };
};

/* ── Future AGI prompts an agent loads ────────────────────────────────────── */

/* The prompt library this workspace can pick from — a stand-in for Prompts. */
export const FAGI_PROMPT_LIBRARY = [
  { promptId: "prm_refund_policy", name: "Refund policy", version: "v4" },
  { promptId: "prm_greeting", name: "Greeting and identity checks", version: "v7" },
  { promptId: "prm_escalation", name: "Escalation rules", version: "v2" },
  { promptId: "prm_tone", name: "Brand tone", version: "v3" },
  { promptId: "prm_rebooking", name: "Rebooking options", version: "v5" },
];

/** [{ promptId, name, version }] it loads today — what the connect step recorded, cleaned. */
export const fagiPromptsOf = (agent) => (Array.isArray(agent?.values?.fagiPrompts) ? agent.values.fagiPrompts : [])
  .filter((p) => p && (p.promptId || p.name) && !p.removedAt)
  .map((p) => ({ promptId: p.promptId || p.name, name: p.name || p.promptId, version: p.version || "v1", addedAt: p.addedAt || null }));

/**
 * The stored list after adding or removing one prompt here. Removal keeps
 * the entry with `removedAt`, so versions saved while it was loaded still pin it.
 */
export const fagiPromptsPatch = (agent, { add, remove }) => {
  const list = Array.isArray(agent?.values?.fagiPrompts) ? agent.values.fagiPrompts : [];
  const now = new Date().toISOString();
  if (add) {
    const rest = list.filter((p) => (p.promptId || p.name) !== add.promptId);
    return { fagiPrompts: [...rest, { promptId: add.promptId, name: add.name, version: add.version, addedAt: now }] };
  }
  return { fagiPrompts: list.map((p) => ((p.promptId || p.name) === remove && !p.removedAt ? { ...p, removedAt: now } : p)) };
};

/* ── git host ─────────────────────────────────────────────────────────────── */

export const GIT_HOSTS = [
  { id: "github", label: "GitHub", icon: "mdi:github" },
  { id: "gitlab", label: "GitLab", icon: "mdi:gitlab", later: true },
  { id: "bitbucket", label: "Bitbucket", icon: "mdi:bitbucket", later: true },
];

/** The repository host improvements open pull requests on. GitHub only in Phase 1. */
export const gitHostOf = (agent) => {
  const id = agent?.values?.gitHost;
  const host = GIT_HOSTS.find((h) => h.id === id && !h.later) || GIT_HOSTS[0];
  return { ...host, recorded: !!id };
};

/** Where its code lives, when it has some — its own repository or one linked to it. */
export const codeRepoOf = (agent) => definitionOf(agent).repoUrl || agent?.values?.repoUrl || agent?.values?.linkedRepo || null;

/* ── platform key scope ───────────────────────────────────────────────────── */

export const PLATFORM_KEY_SCOPE = "This key reads your agent, creates test copies or drafts and places test calls. We never edit, publish or delete your live agent.";

/** A hosted platform we hold a key for (not a pasted prompt run directly). */
export const isHostedPlatform = (agent) => sourceKindOf(agent) === "platform" && agent?.values?.provider !== "other";

export const providerLabelOf = (agent) => PROVIDER_LABELS[agent?.values?.provider] || "the platform";

/* ── speech providers (Constraints → approved list) ───────────────────────── */

export const SPEECH_PROVIDERS = {
  speechIn: ["Deepgram", "AssemblyAI", "OpenAI Whisper", "Google Speech", "Azure Speech", "Speechmatics"],
  speechOut: ["ElevenLabs", "Cartesia", "OpenAI TTS", "PlayHT", "Deepgram Aura", "Azure TTS", "Rime"],
};

/* "Deepgram nova-3" → "Deepgram"; "OpenAI TTS" stays whole. */
export const speechProviderOf = (name) => {
  const s = String(name || "").trim();
  if (!s) return null;
  const all = [...SPEECH_PROVIDERS.speechIn, ...SPEECH_PROVIDERS.speechOut];
  /* The longest name it starts with — "Deepgram Aura 2" is Deepgram Aura, not Deepgram. */
  const hit = all.filter((p) => s.toLowerCase().startsWith(p.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  return hit || s.split(/\s+/)[0];
};

/* ── workspace role (mock) ────────────────────────────────────────────────── */

/* The signed-in user's workspace role. One admin in this prototype; a real
   auth wiring swaps this one function. */
export const currentWorkspaceRole = () => "admin";
export const MAKE_ACTIVE_ADMIN_ONLY = "Only a workspace admin can make a version active.";

/**
 * A built-in agent's active (released) version: the one an admin made
 * active, else the newest version an improvement didn't make. A version an
 * improvement made stays a draft until an admin makes it active.
 *   release — versionReleaseOf(agent, state)
 */
export const activeVersionOf = (agent, release = {}) => {
  const labels = (agent?.versions || []).map((v) => v.label);
  const picked = agent?.values?.activeVersion?.label;
  if (picked && labels.includes(picked)) return picked;
  const live = labels.find((l) => release[l]?.live);
  if (live) return live;
  return [...labels].reverse().find((l) => !release[l]?.from) || labels[0] || null;
};

/* ── moved from Simulate ──────────────────────────────────────────────────── */

export const MOVED_FROM_SIMULATE = "Agent definitions moved here from Simulate — every agent you test now lives in Connected agents.";

/* Deterministic pick, for mock values derived from an agent's identity. */
export const pickFor = (agent, list, salt = "") => list[hash(`${agent?.key || agent?.id || agent?.name}:${salt}`) % list.length];
