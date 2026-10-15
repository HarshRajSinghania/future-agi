/*
  Shared definitions from the updated RSI PRD ("Agents, defined" and
  "Environments, defined"), so every screen reads them the same way.

  · Proof kind — where a candidate ran and how its tools were handled:
      sealed       tools answered by the seeded world in our sandbox (code
                   agents; an imported copy whose tool code was uploaded)
      live         the agent runs in the customer's account and its tools reach
                   their real systems (Vapi and Retell as they run today,
                   phone numbers, endpoints). Needs consent before a first run.
      prompt-only  a Future AGI prompt run without the customer's tools
    plus the trust tier: Run by Future AGI · Run on your machine · Deployed by you.
  · Fix depth — how deep an improvement can go for how the agent came in:
      full · settings · suggestion (agents we can only call) · coding-agent
  · Platform testing — how each hosted platform tests and ships a candidate.
  · Coming soon — agent types outside Phase 1 (browser, computer use…).
  · Personal data — production-derived text keeps the problem, not the person.
*/
import { sourceKindOf } from "./agentRegistry";

/* ── agent types ──────────────────────────────────────────────────────────── */

const COMING_SOON = new Set(["browser", "computer", "cua", "sim", "robotics", "background"]);

/** Agent types the PRD defers past Phase 1 — shown, tagged "Coming soon". */
export const isComingSoon = (thing) => {
  const s = thing?.surface || thing?.typeId || thing?.values?.surface || thing?.type;
  return COMING_SOON.has(String(s || "").replace(/_agent$/, "")) || /browser|computer/i.test(String(thing?.typeId || ""));
};
export const COMING_SOON_NOTE = "Coming soon — browser and computer-use agents. You can look around; improvements don't run on them yet.";

/* ── how deep a fix can go ───────────────────────────────────────────────── */

/* A live assistant on a provider is a platform agent, even when what we read
   back from it is only its prompt. */
const kindOf = (agent) => {
  const v = agent?.values || {};
  if (v.provider && v.provider !== "other" && v.agentId) return "platform";
  return sourceKindOf(agent);
};
const isPhone = (agent) => !!(agent?.values?.phoneNumber || agent?.values?.contact?.mode === "phone-only" || agent?.sourceKind === "phone");

/**
 * full · settings · suggestion · coding-agent, with the PRD's sentence.
 * Agents we can only call (phone number, endpoint) end in a diagnosis and a
 * suggested fix — no proof until the user applies it and a re-run proves it.
 */
export const fixDepthOf = (agent) => {
  const kind = kindOf(agent);
  /* LiveKit and Pipecat are code frameworks: a running agent connected by its
     project can be tested, but a fix goes through its code. */
  if (kind === "platform" && ["livekit", "pipecat"].includes(agent?.values?.provider)) {
    return { depth: "suggestion", label: "Diagnosis and a suggested fix", note: "LiveKit is a code framework, so a fix goes through its code. Connect the agent's repository to get proven changes; connected by its project, it can be tested and gets a suggested fix." };
  }
  if (isPhone(agent) || kind === "endpoint") {
    return { depth: "suggestion", label: "Diagnosis and a suggested fix", note: "We can only call this agent, so an improvement reproduces the failure and ends with a suggested fix. Once you apply it and mark the new version released, a re-run on the same environment version proves it." };
  }
  if (kind === "framework" && agent?.values?.runLocation === "sdk" && agent?.values?.localSdk) {
    return { depth: "coding-agent", label: "Changes by your coding agent, proven by us", note: "A local agent through our SDK: your own coding agent makes the change; we run the proof." };
  }
  if (kind === "platform") {
    return { depth: "settings", label: "The settings the platform's API exposes", note: "Not the code behind the agent's own webhooks, and not the prompt or model of an agent whose replies come from your own model server." };
  }
  return { depth: "full", label: "Everything the change policy allows", note: "Including code and structure, where the change policy allows them." };
};

/* ── proof kind and trust tier ───────────────────────────────────────────── */

export const PROOF_KINDS = {
  sealed: { label: "Sealed", note: "Tool calls were answered by the seeded world inside our sandbox; sub-goals were checked against the world's end state and the agent's tool calls. Strongest proof." },
  live: { label: "Live", note: "The agent ran in your account and its tools reached your real systems. Only the starting state was checked, and a model judged sub-goals from the conversation. Weaker proof." },
  "prompt-only": { label: "Prompt only", note: "The prompt ran on our platform model without your tools, so tool behaviour isn't part of this proof." },
};

export const TRUST_TIERS = {
  ours: { label: "Run by Future AGI", note: "The full proof." },
  local: { label: "Run on your machine", note: "Our scenarios and scoring; the code identity is reported by the agent." },
  deployed: { label: "Deployed by you", note: "Our scenarios and scoring; we can't see what runs there." },
};

/** Where a candidate for this agent runs, and how far its proof can be trusted. */
export const proofKindOf = (agent) => {
  const kind = kindOf(agent);
  const v = agent?.values || {};
  if (kind === "builtin" || v.provider === "other") return { kind: "prompt-only", tier: "ours", ...PROOF_KINDS["prompt-only"], tierLabel: TRUST_TIERS.ours.label };
  if (kind === "platform") {
    /* Phase 1 runs hosted agents live; an imported copy with its tool code uploaded is sealed. */
    const sealed = !!(v.importedCopy && v.toolCodeUploaded);
    return { kind: sealed ? "sealed" : "live", tier: "ours", ...PROOF_KINDS[sealed ? "sealed" : "live"], tierLabel: TRUST_TIERS.ours.label };
  }
  if (kind === "endpoint" || isPhone(agent)) return { kind: "live", tier: "deployed", ...PROOF_KINDS.live, tierLabel: TRUST_TIERS.deployed.label };
  if (kind === "framework" && v.runLocation === "sdk" && v.localSdk) return { kind: "sealed", tier: "local", ...PROOF_KINDS.sealed, tierLabel: TRUST_TIERS.local.label };
  return { kind: "sealed", tier: "ours", ...PROOF_KINDS.sealed, tierLabel: TRUST_TIERS.ours.label };
};

/** Live runs need the user's consent first: test copies/drafts in their account, tools safe to call. */
/* An endpoint's own acknowledgment ("simulations may drive this agent and its
   tools") is the same consent, so it counts too. */
export const needsLiveConsent = (agent) => proofKindOf(agent).kind === "live" && !agent?.values?.liveTestConsent?.at && !agent?.values?.endpointConsent?.acknowledgedAt;

/* ── hosted platforms: how a candidate is tested and shipped ──────────────── */

export const PLATFORM_TESTING = {
  vapi: {
    phase: 1,
    tests: "A test copy in your account, or settings overridden for one call",
    brief: "a test copy",
    ships: "A copy of the assistant, ready to swap in",
    shipAction: "Create a copy to swap in",
    note: "Vapi's API can't create drafts or publish, so a change ships as a copy of the assistant for you to swap in. Keep your Vapi setup as code in GitHub to get a draft pull request instead.",
    released: "Released when the live assistant's settings match the proposal.",
  },
  retell: {
    phase: 1,
    tests: "A draft version, called with that version pinned",
    brief: "a pinned draft",
    ships: "An unpublished draft version",
    shipAction: "Create a draft version",
    needsPinnedNumbers: true,
    note: "A new Retell draft becomes the newest version, so a live number that follows the newest version would start taking real calls on it. Pin those numbers to a released version first; until then we test with settings overridden for one call.",
    released: "Released when your live numbers use it, pinned directly or through a tag such as prod. Publishing alone only freezes a version.",
  },
  elevenlabs: {
    phase: 2,
    tests: "A branch, checked with the platform's own test runs",
    brief: "a branch",
    ships: "A branch",
    shipAction: "Create a branch",
    needsVersioning: true,
    note: "Branches need versioning switched on for the agent, which can't be undone — you switch it on.",
    released: "Released when the branch is merged into the live agent.",
  },
  bland: {
    phase: 2,
    tests: "A branch, called directly by name",
    brief: "a branch",
    ships: "A branch",
    shipAction: "Create a branch",
    note: "Bland's new agent model. Older pathway agents follow after Bland's 15 Nov 2026 migration deadline.",
    released: "Released when the branch goes live.",
  },
};
export const platformTestingOf = (agent) => PLATFORM_TESTING[agent?.values?.provider] || null;

/* ── configuration areas (the Constraints tab) ───────────────────────────── */

export const CONFIG_AREAS = [
  { id: "instructions", label: "Instructions", covers: "System prompt, prompts for each step, persona and guardrail wording", applies: "both", allow: "default" },
  { id: "opening", label: "Opening and closing", covers: "First message, who speaks first, end-call phrases, voicemail message", applies: "both", allow: "default", note: "Lines allowed by default; who speaks first when allowed" },
  { id: "model", label: "Model", covers: "Provider, model, temperature, response length, reasoning effort, fallback model", applies: "both", allow: "optional", note: "The model and provider only within the model lock's approved list" },
  { id: "speechIn", label: "Speech in", covers: "Transcriber, language, keywords to recognise, noise handling", applies: "voice", allow: "optional", note: "Providers only within the approved list" },
  { id: "speechOut", label: "Speech out", covers: "Voice provider, voice, speed, stability, pronunciation", applies: "voice", allow: "off", note: "Starts off — the voice is part of the brand" },
  { id: "turnTaking", label: "Turn-taking", covers: "End-of-turn detection, interruption sensitivity, backchannels, silence timeout, maximum call length", applies: "voice", allow: "optional" },
  { id: "tools", label: "Tools", covers: "Tool descriptions and parameters, built-in actions such as transfer or end call, MCP servers", applies: "both", allow: "default", note: "Descriptions allowed by default; adding or removing tools only for code agents" },
  { id: "knowledge", label: "Knowledge", covers: "Knowledge bases and retrieval settings", applies: "both", allow: "optional", note: "Retrieval settings yes; knowledge content only as a suggestion" },
  { id: "structure", label: "Structure", covers: "Single prompt, a flow of steps, handoffs between agents, a code graph", applies: "both", allow: "optional", note: "With a written rationale on every proposal" },
  { id: "variables", label: "Variables", covers: "Values filled in for each conversation, and their defaults", applies: "both", allow: "optional", note: "Defaults only" },
  { id: "analysis", label: "Analysis", covers: "Post-call analysis, structured outputs and success criteria", applies: "both", allow: "never", note: "Never — these act as judges, and the improver may not edit its judges" },
  { id: "account", label: "Account", covers: "Credentials, phone numbers, data retention, compliance settings, concurrency and release tags", applies: "both", allow: "never", note: "Never" },
];

/* ── personal data in production-derived text ────────────────────────────── */

const FAKE_NAMES = ["Alex Morgan", "Sam Rivera", "Jordan Lee", "Taylor Brooks", "Casey Patel", "Riley Chen"];
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

/**
 * The problem, not the person: names (from `names`), phone numbers, emails,
 * addresses, account and card numbers become realistic fake values —
 * deterministic, so the same person reads the same throughout one scenario.
 * Returns { text, replaced } where replaced counts by kind.
 */
export const scrubPersonalData = (input, { names = [] } = {}) => {
  let text = String(input || "");
  const replaced = { names: 0, phones: 0, emails: 0, addresses: 0, numbers: 0 };
  names.filter(Boolean).forEach((n) => {
    const re = new RegExp(String(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    text = text.replace(re, () => { replaced.names += 1; return FAKE_NAMES[hash(n) % FAKE_NAMES.length]; });
  });
  text = text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, (m) => { replaced.emails += 1; return `user${hash(m) % 900 + 100}@example.com`; });
  text = text.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => { replaced.numbers += 1; return `4111 1111 1111 ${String(hash(m) % 9000 + 1000)}`; });
  text = text.replace(/(\+?\d{1,3}[ -]?)?\(?\d{3}\)?[ -]?\d{3}[ -]?\d{4}\b/g, (m) => { replaced.phones += 1; return `+1 555 01${String(hash(m) % 90 + 10)} ${String(hash(m) % 9000 + 1000)}`; });
  text = text.replace(/\b\d{1,5}\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd)\b\.?/g, (m) => { replaced.addresses += 1; return `${hash(m) % 900 + 100} Market Street`; });
  text = text.replace(/\b(?:acct|account|order)[ #:-]*\d{6,}\b/gi, (m) => { replaced.numbers += 1; return m.replace(/\d{6,}/, String(hash(m) % 900000 + 100000)); });
  return { text, replaced, count: Object.values(replaced).reduce((a, b) => a + b, 0) };
};

/* ── scenarios from production (workspace-admin switch) ──────────────────── */

/** Production-derived sources (Error Feed, production replay) are on unless an admin turned them off. */
/** Retell numbers pinned to a released version (`values.retellNumbersPinned = { at, version }`). */
export const numbersPinned = (agent) => !!(agent?.values?.retellNumbersPinned?.at || agent?.values?.retellNumbersPinned === true);

/* A workspace-admin setting (`state.workspaceSettings.productionScenarios`).
   Pass the workspace settings; without them, an environment's older
   per-environment value is read, as before. */
export const productionScenariosOn = (envState, workspace) => (typeof workspace?.productionScenarios === "boolean"
  ? workspace.productionScenarios
  : envState?.productionScenarios !== false);
export const PRODUCTION_OFF_REASON = "Scenarios from production are turned off for this workspace. A workspace admin can turn them back on in workspace settings.";

/* ── run settings defaults (env Settings) ────────────────────────────────── */

export const SIMULATOR_MODELS = [
  { id: "gpt-4o-mini", label: "GPT-4o mini", note: "Fast and cheap; the default" },
  { id: "gpt-4.1", label: "GPT-4.1", note: "Follows long caller briefs more closely" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", note: "Holds a persona over long conversations" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "Lowest latency for voice" },
];
export const RUN_DEFAULTS = { repeats: 3, conversationsAtOnce: 4, simulatorModel: "gpt-4o-mini" };
export const REPEATS_MAX = 20;
export const PARALLEL_MAX = 4;

/**
 * What a new run starts from: repeats per scenario (1–20), conversations at
 * once (≤4 when parallel), the simulated user's model. Parallel runs are
 * stored on `envState.parallelRuns` (default on; false → one at a time) —
 * the field the runs read.
 */
export const runDefaultsOf = (envState) => {
  const saved = envState?.runDefaults || {};
  const d = { ...RUN_DEFAULTS, ...saved };
  const repeats = Math.min(REPEATS_MAX, Math.max(1, Math.round(Number(d.repeats) || RUN_DEFAULTS.repeats)));
  const parallel = envState?.parallelRuns !== false;
  const conversationsAtOnce = parallel ? Math.min(PARALLEL_MAX, Math.max(2, Math.round(Number(d.conversationsAtOnce) || 2))) : 1;
  return { ...d, repeats, parallel, conversationsAtOnce };
};

/* ── agent lifecycle, main environment, channels (agents builder) ────────── */
/* Kept in agentLifecycle.js and read from here, so every screen asks one module. */
export {
  agentStatusOf, AGENT_STATUS_LABELS, disconnectReasonFor, deleteBlockOf, mainEnvOf,
  agentChannelsOf, channelEnvsOf, CHANNEL_LABELS, retellPinStateOf, releaseDetectionOf,
  CLOSED_PLATFORMS, CLOSED_PLATFORM_NOTE, FRAMEWORK_TUNING, FRAMEWORK_TUNING_NOTE, frameworkPhaseOf,
} from "./agentLifecycle";
