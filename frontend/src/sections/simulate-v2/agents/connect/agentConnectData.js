/*
  New agent's ways in — the same directory and paste bar as the Environments
  landing, mapped onto the agent flows. Each item names the flow (`kind`) and
  what it starts with (`initial`): a platform, a framework, a pasted ID.
*/
import { FRAMEWORK_META } from "../../_mock/agentRegistry";
import { detectPaste } from "../../environments/landingData";

const frameworkItems = Object.entries(FRAMEWORK_META).map(([id, f]) => ({
  id: `fw-${id}`,
  name: f.label,
  icon: f.icon,
  need: `SDK adapter · ${f.structure.toLowerCase()}`,
  kind: "framework",
  initial: { framework: id },
}));

export const AGENT_CONNECT_GROUPS = [
  {
    id: "voice",
    title: "Voice platforms",
    reach: "Your API key and assistant — tested live in your account.",
    items: [
      { id: "vapi", name: "Vapi", logo: "vapi", need: "API key · assistant", kind: "hosted", channels: ["voice"], initial: { agentType: "voice", platform: "vapi" } },
      { id: "retell", name: "Retell AI", logo: "retell", need: "API key · agent", kind: "hosted", channels: ["voice"], initial: { agentType: "voice", platform: "retell" } },
      { id: "livekit", name: "LiveKit", logo: "livekit", need: "Server URL · agent name", kind: "hosted", channels: ["voice"], initial: { agentType: "voice", platform: "livekit" } },
      { id: "elevenlabs", name: "ElevenLabs", logo: "elevenlabs", need: "Agents API key", kind: "hosted", channels: ["voice"], initial: { agentType: "voice", platform: "elevenlabs" } },
      { id: "bland", name: "Bland.ai", logo: "bland", need: "API key · agent", kind: "hosted", channels: ["voice"], initial: { agentType: "voice", platform: "bland" } },
    ],
  },
  {
    id: "chat",
    title: "Chat and built here",
    reach: "Build one here, or bring a Vapi chat assistant.",
    items: [
      { id: "vapi-chat", name: "Vapi chat", logo: "vapi", need: "Same assistant, over chat", kind: "hosted", channels: ["chat"], initial: { agentType: "chat", platform: "vapi" } },
      { id: "builtin", name: "Build in Future AGI", icon: "solar:widget-add-linear", need: "Prompt, model and tools", kind: "builtin", channels: ["chat", "voice"] },
    ],
  },
  {
    id: "code",
    title: "Repo and SDK",
    reach: "We read your repo or SDK — fixes come back as pull requests.",
    items: [
      { id: "github", name: "GitHub", logo: "github", need: "Read-only app · repo and folder", kind: "repo" },
      ...frameworkItems,
      { id: "gitlab", name: "GitLab", logo: "gitlab", need: "Read-only app", later: true },
      { id: "bitbucket", name: "Bitbucket", logo: "bitbucket", need: "Read-only app", later: true },
    ],
  },
  {
    id: "other",
    title: "Other ways",
    reach: "Anything we can call, upload or phone.",
    items: [
      { id: "upload", name: "Upload a folder", icon: "solar:upload-minimalistic-linear", need: "Folder or .zip, up to 200 MB", kind: "upload" },
      { id: "running", name: "Agent endpoint", icon: "solar:global-linear", need: "HTTP or WebSocket URL", kind: "running", channels: ["chat", "voice"] },
      { id: "phone", name: "Phone number", icon: "solar:phone-calling-rounded-linear", need: "Any agent you can call", kind: "phone", channels: ["voice"] },
    ],
  },
];

/* Where an agent is connected for one environment (`channel`, e.g.
   "voice"), only the ways that can bring that type of agent: an option
   tagged with other channels drops out, and every option that's left opens
   with the agent type set. Code is untagged — the code says what it is. A
   group left with only "built here" is named for that. */
const CHANNEL_GROUP_TITLES = { chat: { voice: { title: "Built here", reach: "Defined and run in Future AGI. Fixes ship as a new version." } } };
export const connectGroupsFor = (channel) => (!channel ? AGENT_CONNECT_GROUPS : AGENT_CONNECT_GROUPS
  .map((g) => ({
    ...g,
    ...(CHANNEL_GROUP_TITLES[g.id]?.[channel] || {}),
    items: g.items
      .filter((it) => !it.channels || it.channels.includes(channel))
      .map((it) => ({ ...it, initial: { ...(it.initial || {}), agentType: channel } })),
  }))
  .filter((g) => g.items.length));
export const pasteExamplesFor = (channel) => (!channel ? AGENT_PASTE_EXAMPLES : AGENT_PASTE_EXAMPLES.filter((e) => !e.channels || e.channels.includes(channel)));

/* Examples that make sense for an agent (no MCP — that's tools, not an agent). */
export const AGENT_PASTE_EXAMPLES = [
  { id: "github", label: "GitHub repo", logo: "github", value: "https://github.com/skyline-air/rebooking-agent" },
  { id: "vapi", label: "Vapi assistant ID", logo: "vapi", channels: ["voice"], value: "3f9c2ab1-4d7e-4c1a-9b2f-8e61d0a5c7e4" },
  { id: "retell", label: "Retell agent ID", logo: "retell", channels: ["voice"], value: "agent_9f2c41d8e7" },
  { id: "endpoint", label: "Endpoint", icon: "solar:global-linear", channels: ["chat"], value: "https://api.acme.com/agent/chat" },
  { id: "prompt", label: "A prompt", icon: "solar:document-text-linear", channels: ["chat"], value: "You are a friendly refill assistant for Acme Pharmacy. Check insurance before booking a pickup slot." },
];

/* What a pasted string opens on New agent: the environment detector's
   reading, mapped onto the agent flows. `choice` is the flow kind. */
const KIND_OF_CHOICE = { hosted: "hosted", source: "repo", running: "running", phone: "phone", scratch: "builtin" };

export const detectAgentPaste = (raw) => {
  const found = detectPaste(raw);
  if (!found) return null;
  if (found.kind === "mcp") {
    return { ...found, blocked: true, choice: null, note: "That's tools, not an agent — build an environment from it instead." };
  }
  if (found.kind === "describe") {
    return { ...found, label: "A prompt", note: "We'll start an agent built in Future AGI with it.", choice: "builtin", prefill: { prompt: found.prefill.flowText } };
  }
  const kind = found.choice ? KIND_OF_CHOICE[found.choice] : null;
  return kind ? { ...found, choice: kind } : { ...found, choice: null, blocked: true };
};
