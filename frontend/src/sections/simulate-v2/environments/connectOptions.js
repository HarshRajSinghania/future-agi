/*
  Shared data for the "connect your own agent" panels — the environment
  builder's and the Agents page's New agent flow. Kept out of the .jsx so
  those files export components only.
*/
import { countries } from "src/assets/data/countries";
import vapiLogo from "./platform-logos/vapi.svg?raw";
import retellLogo from "./platform-logos/retell.svg?raw";
import blandLogo from "./platform-logos/bland.svg?raw";
import elevenlabsLogo from "./platform-logos/elevenlabs.svg?raw";
import livekitLogo from "./platform-logos/livekit.svg?raw";

/* Official brand marks for the hosted voice platforms, inlined so they inherit
   `currentColor` (theme-aware). Each vendor's own published logo, used to
   identify its integration — the same way the app labels its other service
   integrations. `wordmark` logos already contain the brand name (so the chip
   drops its text label); `mark` logos are a symbol only (chip keeps the name). */
export const PLATFORM_LOGOS = {
  vapi: { svg: vapiLogo, type: "wordmark", maxWidth: 46 },
  retell: { svg: retellLogo, type: "wordmark", maxWidth: 54 },
  bland: { svg: blandLogo, type: "mark" },
  elevenlabs: { svg: elevenlabsLogo, type: "mark" },
  livekit: { svg: livekitLogo, type: "mark" },
};

/* Hosted-platform providers grouped by agent type — the platform roster
   only makes sense once we know what kind of agent is being connected.
   Voice mirrors the `voice_platform` provider list in _mock/agentTypes.js;
   the other types round out the pattern with the platforms teams
   actually reach for in each space. Adding a provider here (or a whole
   new agent type) is the extension point when the product grows. */
export const AGENT_TYPES = [
  { id: "voice", label: "Voice", icon: "solar:phone-calling-rounded-linear" },
  { id: "chat", label: "Chat", icon: "solar:chat-round-linear" },
  { id: "computer", label: "Computer use", icon: "solar:monitor-linear", comingSoon: true },
  { id: "code", label: "Code", icon: "solar:code-square-linear", comingSoon: true },
  { id: "robotics", label: "Robotics", icon: "solar:cpu-bolt-linear", comingSoon: true },
];

export const HOSTED_PLATFORMS_BY_TYPE = {
  voice: [
    { id: "vapi", name: "Vapi", icon: "solar:phone-calling-rounded-linear", brand: "#12A594", idLabel: "Assistant ID", idPlaceholder: "asst_9f2c…", keyLabel: "Vapi API key" },
    { id: "retell", name: "Retell AI", icon: "solar:microphone-3-linear", brand: "#635BFF", idLabel: "Agent ID", idPlaceholder: "agent_9f2c…", keyLabel: "Retell API key" },
    /* Bland's new agent model: agents, not pathways. Pathway agents follow
       after Bland's 15 Nov migration deadline. */
    { id: "bland", name: "Bland.ai", icon: "solar:phone-linear", brand: "#F26D5B", idLabel: "Agent ID", idPlaceholder: "agent_9f2c…", idNote: "Bland's new agent model. Still on a pathway? Pathway agents can connect after Bland's 15 Nov migration.", keyLabel: "Bland API key" },
    { id: "elevenlabs", name: "ElevenLabs", icon: "solar:soundwave-linear", brand: "#111111", idLabel: "Agent ID", idPlaceholder: "agent_9f2c…", keyLabel: "ElevenLabs API key" },
    { id: "livekit", name: "LiveKit", icon: "solar:server-minimalistic-linear", brand: "#1FD5F9", idLabel: "Agent name", idPlaceholder: "returns-line-agent", keyLabel: "LiveKit API key" },
    /* No platform — a pasted system prompt we run against the LLM directly. */
    { id: "other", name: "Others", icon: "solar:menu-dots-linear", isOther: true },
  ],
  /* Vapi assistants take chat as well as calls. OpenAI Assistants is gone —
     retired by OpenAI; an Agents SDK agent comes in as code. */
  chat: [
    { id: "vapi", name: "Vapi", icon: "solar:chat-round-linear", brand: "#12A594", idLabel: "Assistant ID", idPlaceholder: "asst_9f2c…", keyLabel: "Vapi API key" },
    { id: "langgraph", name: "LangGraph Cloud", icon: "solar:diagram-up-linear", idLabel: "Deployment URL", idPlaceholder: "https://…", keyLabel: "LangSmith API key", comingSoon: true },
    { id: "crewai", name: "CrewAI", icon: "solar:users-group-rounded-linear", idLabel: "Crew ID", idPlaceholder: "crew_9f2c…", keyLabel: "CrewAI API key", comingSoon: true },
    { id: "claude_agents", name: "Claude Agents", icon: "solar:atom-linear", idLabel: "Agent name", idPlaceholder: "support-agent", keyLabel: "Anthropic API key", comingSoon: true },
  ],
  computer: [
    { id: "browserbase", name: "Browserbase", icon: "solar:global-linear", idLabel: "Session template ID", idPlaceholder: "sess_9f2c…", keyLabel: "Browserbase API key" },
    { id: "anthropic_cu", name: "Anthropic Computer Use", icon: "solar:monitor-linear", idLabel: "Agent name", idPlaceholder: "returns-agent", keyLabel: "Anthropic API key" },
    { id: "skyvern", name: "Skyvern", icon: "solar:mouse-linear", idLabel: "Task template ID", idPlaceholder: "tmpl_9f2c…", keyLabel: "Skyvern API key" },
  ],
  code: [
    { id: "devin", name: "Devin", icon: "solar:code-linear", idLabel: "Agent slug", idPlaceholder: "acme/refactor-bot", keyLabel: "Cognition API key" },
    { id: "replit_agent", name: "Replit Agent", icon: "solar:code-square-linear", idLabel: "Repl URL", idPlaceholder: "https://replit.com/@…", keyLabel: "Replit API key" },
    { id: "cursor_bg", name: "Cursor background agent", icon: "solar:cursor-linear", idLabel: "Agent ID", idPlaceholder: "cursor_9f2c…", keyLabel: "Cursor API key" },
  ],
  robotics: [
    { id: "gr00t", name: "NVIDIA GR00T Cloud", icon: "solar:cpu-bolt-linear", idLabel: "Policy ID", idPlaceholder: "policy_9f2c…", keyLabel: "NVIDIA API key" },
    { id: "physical_intelligence", name: "Physical Intelligence π₀", icon: "solar:reorder-linear", idLabel: "Model name", idPlaceholder: "pi0-generalist", keyLabel: "PI API key" },
  ],
};

/* Platforms we'll connect later — shown so nobody wonders whether theirs
   is missing, never selectable. Same row for voice and chat. */
export const LATER_PLATFORMS = [
  { id: "telnyx", name: "Telnyx", icon: "solar:phone-calling-linear" },
  { id: "google_cx", name: "Google CX Agent Studio", icon: "solar:cloud-linear" },
  { id: "voiceflow", name: "Voiceflow", icon: "solar:routing-2-linear" },
  { id: "agentforce", name: "Agentforce", icon: "solar:cloud-linear" },
  { id: "copilot_studio", name: "Copilot Studio", icon: "solar:chat-square-linear" },
];

/* What a platform API key is used for — said where the key is entered. */
export const PLATFORM_KEY_SCOPE = "This key reads your agent, creates test copies or drafts and places test calls. We never edit, publish or delete your live agent.";

/* Retired, so it's said in the framework path. */
export const OPENAI_AGENT_BUILDER_NOTE = "OpenAI Agent Builder is shutting down — bring Agents SDK agents in as code.";
export const TRACEAI_FRAMEWORK_NOTE = "traceAI traces every framework here except Microsoft Agent Framework.";

export const isLivePlatform = (p) => !!p && !p.comingSoon && !p.later;
export const firstLive = (platforms) => platforms.find(isLivePlatform);

/* Full country list from src/assets/data/countries. Ordering surfaces
   the `suggested` markets first (US, GB, IN, AU, DE, FR, …), then the
   rest alphabetised, so the picker opens on the countries the voice
   pilots actually land in without hiding the long tail. */
const flagOf = (iso) =>
  iso && iso.length === 2
    ? String.fromCodePoint(...iso.toUpperCase().split("").map((c) => 0x1F1E6 + c.charCodeAt(0) - 65))
    : "";

export const COUNTRY_OPTIONS = (() => {
  const filled = countries.filter((c) => c.code && c.phone);
  /* `phone` in the seed uses "1-268" for territories that share a
     dial prefix — we keep just the leading trunk so the picker never
     shows a hyphenated code the user cannot type. */
  const cleaned = filled.map((c) => ({
    iso: c.code,
    name: c.label,
    dial: `+${String(c.phone).split("-")[0]}`,
    suggested: !!c.suggested,
    flag: flagOf(c.code),
  }));
  const suggested = cleaned.filter((c) => c.suggested);
  const rest = cleaned.filter((c) => !c.suggested).sort((a, b) => a.name.localeCompare(b.name));
  return [...suggested, ...rest];
})();

export const COUNTRY_BY_ISO = Object.fromEntries(COUNTRY_OPTIONS.map((c) => [c.iso, c]));

