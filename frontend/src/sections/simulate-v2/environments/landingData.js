/*
  The Environments landing screen's data: what a pasted string is, the
  directory of ways to connect an agent, the seeds (ready-made worlds with a
  stand-in agent and a finished demo run) and the prebuilt worlds. Kept out of
  the .jsx so the landing file exports components only.

  Every entry opens one of the existing setup panels (StartEnvironment's
  PANELS) with what we already know filled in — `{ choice, prefill }`.
*/
import { ENVIRONMENT_TEMPLATES } from "../_mock/environments";
import { packStats } from "../_mock/scenarios";
import { TWIN_CATALOG } from "../_mock/twins";

/* ── what a pasted string is ───────────────────────────────────────────── */

const GITHUB = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$|^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i;
const GITLAB = /(?:^|\/\/|@)(?:www\.)?gitlab\.com[/:]/i;
const BITBUCKET = /(?:^|\/\/|@)(?:www\.)?bitbucket\.org[/:]/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE = /^\+?[\d\s().-]{8,}$/;
const URL_LIKE = /^(?:https?|wss?):\/\/\S+$/i;
/* Raw secrets: never accepted here — keys go in by secret-manager reference. */
const RAW_KEY = /^(sk|pk|rk|key|api)[-_][\w-]{12,}$|^[A-Za-z0-9_-]{32,}$/;

/**
 * What a pasted string looks like, and where it goes.
 * { kind, label, detail, choice, prefill, logo, tag?, blocked?, warn? } or null.
 *   blocked  recognised, but not a path we can take today (said why).
 *   warn     a raw secret — refused, with where it belongs instead.
 */
export const detectPaste = (raw) => {
  const text = String(raw || "").trim();
  if (!text) return null;
  const gh = GITHUB.exec(text);
  if (gh) {
    const repo = `${gh[1] || gh[3]}/${(gh[2] || gh[4]).replace(/\.git$/, "")}`;
    return {
      kind: "github", label: "GitHub repository", detail: repo, logo: "github",
      note: "Read through the GitHub App — fixes open as draft pull requests.",
      choice: "source", prefill: { repo },
    };
  }
  if (GITLAB.test(text) || BITBUCKET.test(text)) {
    const host = GITLAB.test(text) ? "GitLab" : "Bitbucket";
    return {
      kind: "git-later", label: `${host} repository`, detail: text.replace(/^https?:\/\//, ""), logo: host.toLowerCase(), tag: "Coming soon",
      note: `${host} is coming soon. Upload the folder instead, or connect it from GitHub.`,
      blocked: true,
    };
  }
  if (/^vault:\/\/|^aws-sm:\/\/|^gcp-sm:\/\//i.test(text)) {
    return {
      kind: "secret-ref", label: "Secret reference", detail: text, icon: "solar:key-minimalistic-square-linear",
      note: "A key reference goes with its platform — pick the platform in Connect your agent below.",
      blocked: true,
    };
  }
  if (RAW_KEY.test(text) && !UUID.test(text) && !/^(asst|agent)_/i.test(text)) {
    return {
      kind: "raw-key", label: "Looks like an API key", detail: "Not kept", icon: "solar:shield-warning-linear",
      note: "Keys never go in here. Add it to your secret manager, then pick the platform below and reference it.",
      warn: true, blocked: true,
    };
  }
  if (/\/(mcp|sse)\b|^npx\s|^uvx\s|^docker\s+run\b/i.test(text)) {
    const transport = /^(npx|uvx|docker)\s/i.test(text) ? "stdio" : /\/sse\b/i.test(text) ? "sse" : "http";
    return {
      kind: "mcp", label: "MCP server", detail: text, logo: "mcp",
      note: "Its tools become the environment's action space — connect the agent afterwards.",
      choice: "mcp", prefill: { target: text, transport },
    };
  }
  if (/^wss:\/\/[\w.-]*livekit\.cloud/i.test(text)) {
    return {
      kind: "livekit", label: "LiveKit server", detail: text.replace(/^wss:\/\//, ""), logo: "livekit",
      note: "Next, name the agent and reference its LiveKit key.",
      choice: "hosted", prefill: { agentType: "voice", platform: "livekit" },
    };
  }
  if (UUID.test(text) || /^asst_/i.test(text)) {
    return {
      kind: "vapi", label: "Vapi assistant ID", detail: text, logo: "vapi",
      note: "Tested live in your account on a copy we make — reference your Vapi key next.",
      choice: "hosted", prefill: { agentType: "voice", platform: "vapi", agentId: text },
    };
  }
  if (/^agent_[\w]{6,}$/i.test(text)) {
    return {
      kind: "retell", label: "Retell agent ID", detail: text, logo: "retell",
      note: "Tested on a pinned draft in your account — reference your Retell key next.",
      choice: "hosted", prefill: { agentType: "voice", platform: "retell", agentId: text },
    };
  }
  if (PHONE.test(text) && text.replace(/\D/g, "").length >= 8) {
    return {
      kind: "phone", label: "Phone number", detail: text, icon: "solar:phone-calling-rounded-linear",
      note: "We call it like a customer would. Test only — improvements end in a suggested fix.",
      choice: "phone", prefill: { number: text },
    };
  }
  if (URL_LIKE.test(text)) {
    return {
      kind: "endpoint", label: "Agent endpoint", detail: text.replace(/^https?:\/\//, ""), icon: "solar:global-linear",
      note: "We call it on every simulated turn. Tell us where the reply sits next.",
      choice: "running", prefill: { endpoint: text, transport: /^wss?:/i.test(text) ? "websocket" : "http" },
    };
  }
  if (text.split(/\s+/).length >= 6) {
    return {
      kind: "describe", label: "A description", detail: `${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`, icon: "solar:document-text-linear",
      note: "No agent yet? We'll draft the world from this — connect an agent when it's ready.",
      choice: "scratch", prefill: { flowText: text },
    };
  }
  return {
    kind: "unknown", label: "Not recognised yet", detail: text, icon: "solar:question-circle-linear",
    note: "Try a GitHub URL, a Vapi or Retell ID, an MCP URL, an endpoint, a phone number — or describe the agent in a sentence.",
    blocked: true,
  };
};

/* One click fills the field with a real-looking example of each kind. */
export const PASTE_EXAMPLES = [
  { id: "github", label: "GitHub repo", logo: "github", value: "https://github.com/skyline-air/rebooking-agent" },
  { id: "vapi", label: "Vapi assistant ID", logo: "vapi", value: "3f9c2ab1-4d7e-4c1a-9b2f-8e61d0a5c7e4" },
  { id: "retell", label: "Retell agent ID", logo: "retell", value: "agent_9f2c41d8e7" },
  { id: "mcp", label: "MCP URL", logo: "mcp", value: "https://tools.acme.dev/mcp" },
  { id: "endpoint", label: "Endpoint", icon: "solar:global-linear", value: "https://api.acme.com/agent/chat" },
  { id: "describe", label: "A sentence", icon: "solar:document-text-linear", value: "A pharmacy refill line that checks insurance before booking a pickup slot" },
];

/* ── the directory of ways in ───────────────────────────────────────────── */

/*
  Grouped by where the agent lives today, each group with the one line a buyer
  needs: how we test it there, and how far a fix can go. `need` is what they'll
  be asked for. Coming soon and Later entries stay visible so nobody wonders
  whether theirs is missing — they just can't be picked.
*/
export const CONNECT_GROUPS = [
  {
    id: "voice",
    title: "Voice platforms",
    reach: "Tested live in your account. Fixes ship as a copy or draft you swap in.",
    items: [
      { id: "vapi", name: "Vapi", logo: "vapi", need: "API key · assistant ID", choice: "hosted", prefill: { agentType: "voice", platform: "vapi" } },
      { id: "retell", name: "Retell AI", logo: "retell", need: "API key · agent ID", choice: "hosted", prefill: { agentType: "voice", platform: "retell" } },
      { id: "livekit", name: "LiveKit", logo: "livekit", need: "Server URL · agent name", choice: "hosted", prefill: { agentType: "voice", platform: "livekit" } },
      { id: "elevenlabs", name: "ElevenLabs", logo: "elevenlabs", need: "Agents API key", choice: "hosted", prefill: { agentType: "voice", platform: "elevenlabs" } },
      { id: "bland", name: "Bland.ai", logo: "bland", need: "API key · agent ID", choice: "hosted", prefill: { agentType: "voice", platform: "bland" } },
      { id: "phone", name: "Phone number", icon: "solar:phone-calling-rounded-linear", need: "Any agent you can call", choice: "phone" },
    ],
  },
  {
    id: "chat",
    title: "Chat and prompts",
    reach: "Vapi chat runs live. A pasted prompt runs on our model — fixes ship as a new prompt version.",
    items: [
      { id: "vapi-chat", name: "Vapi chat", logo: "vapi", need: "Same assistant, over chat", choice: "hosted", prefill: { agentType: "chat", platform: "vapi" } },
      { id: "prompt", name: "Paste a system prompt", icon: "solar:document-text-linear", need: "No key or endpoint", choice: "hosted", prefill: { agentType: "voice", platform: "other" } },
      { id: "langgraph", name: "LangGraph Cloud", logo: "langgraph", need: "Deployment URL · key", soon: true },
      { id: "crewai", name: "CrewAI", logo: "crewai", need: "Crew endpoint", soon: true },
      { id: "claude-agents", name: "Claude Agents", logo: "claude", need: "API key", soon: true },
    ],
  },
  {
    id: "code",
    title: "Source code",
    reach: "We read the code. Fixes reach prompts, tools and code — as draft pull requests.",
    items: [
      { id: "github", name: "GitHub", logo: "github", need: "Read-only app · repo and folder", choice: "source" },
      { id: "upload", name: "Upload a folder", icon: "solar:upload-minimalistic-linear", need: "Folder or .zip, up to 200 MB", choice: "upload" },
      { id: "gitlab", name: "GitLab", logo: "gitlab", need: "Read-only app", later: true },
      { id: "bitbucket", name: "Bitbucket", logo: "bitbucket", need: "Read-only app", later: true },
    ],
  },
  {
    id: "other",
    title: "Endpoints and tools",
    reach: "An agent we can only call is test only. Tools and runtimes build a world first.",
    items: [
      { id: "endpoint", name: "Agent endpoint", icon: "solar:global-linear", need: "HTTP or WebSocket URL", choice: "running" },
      { id: "mcp", name: "MCP server", logo: "mcp", need: "HTTP · SSE · stdio", choice: "mcp" },
      { id: "local", name: "Build locally", icon: "solar:laptop-minimalistic-linear", need: "Secure tunnel from your machine", choice: "local" },
    ],
  },
];

/** Groups with only the items a search matches; groups keep their place. */
export const filterGroups = (query) => {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return CONNECT_GROUPS;
  return CONNECT_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => `${it.name} ${it.need} ${g.title}`.toLowerCase().includes(q)),
  }));
};

export const itemCount = CONNECT_GROUPS.reduce((n, g) => n + g.items.length, 0);

/* ── seeds and prebuilt worlds ──────────────────────────────────────────── */

/*
  A prebuilt world is ready to run — tables, tools, rules, starter scenarios,
  and a placeholder agent until you connect yours. A seed (shown as a
  ready-made example) has already run: a stand-in agent and a finished demo
  run to read. Seeds are never prebuilt worlds too, so the lists don't overlap.
*/

/* The kind of agent a world is built for — the same five as the agent types. */
export const WORLD_TYPES = [
  { id: "voice", label: "Voice" },
  { id: "chat", label: "Chat" },
  { id: "computer", label: "Computer use", soon: true },
  { id: "code", label: "Code", soon: true },
  { id: "robotics", label: "Robotics", soon: true },
];
const TYPE_OF_AGENT = {
  voice_platform: "voice",
  chat_webhook: "chat", api_agent: "chat", mcp_agent: "chat",
  browser_agent: "computer", game_agent: "computer",
  coding_agent: "code",
  sim_agent: "robotics",
};
export const worldTypeOf = (agentType) => WORLD_TYPES.find((t) => t.id === (TYPE_OF_AGENT[agentType] || "chat"));

const DOMAIN_LABEL = {
  ecommerce: "E-commerce", fintech: "Finance", travel: "Travel", software: "Software", robotics: "Robotics",
  gaming: "Games", research: "Research", operations: "Operations", ml: "Machine learning", hardware: "Hardware",
  support: "Support", sales: "Sales",
};
export const domainLabelOf = (d) => DOMAIN_LABEL[d] || (d ? d.charAt(0).toUpperCase() + d.slice(1) : "Other");

/** Prebuilt worlds — the template catalogue, most used first. */
export const prebuiltWorlds = () => ENVIRONMENT_TEMPLATES
  .filter((t) => t.agentType !== "twin_backed")
  .map((t) => {
    const type = worldTypeOf(t.agentType);
    return {
      id: t.id,
      name: t.name,
      tagline: t.tagline,
      type: type.id,
      typeLabel: type.label,
      soon: !!type.soon,
      domain: t.domain,
      domainLabel: domainLabelOf(t.domain),
      tools: (t.tools || []).length,
      tables: (t.seed?.tables || []).length,
      scenarios: packStats(t).scenarios,
      popularity: t.popularity || 0,
      template: t,
    };
  })
  /* Worlds you can connect an agent to today first, then the rest. */
  .sort((a, b) => (a.soon - b.soon) || (b.popularity - a.popularity));

/** Worlds a search, a type and a domain leave. */
export const filterWorlds = (worlds, { query = "", type = "all", domain = "all" } = {}) => {
  const q = query.trim().toLowerCase();
  return worlds.filter((w) => (type === "all" || w.type === type)
    && (domain === "all" || w.domain === domain)
    && (!q || `${w.name} ${w.tagline} ${w.domainLabel} ${w.typeLabel}`.toLowerCase().includes(q)));
};

/* ── the New environment journey ───────────────────────────────────────── */

/** SaaS sandboxes for web environments. */
export const sandboxServices = () => TWIN_CATALOG.map((t) => ({ id: t.id, name: t.name, icon: t.icon, iconDark: t.iconDark }));
