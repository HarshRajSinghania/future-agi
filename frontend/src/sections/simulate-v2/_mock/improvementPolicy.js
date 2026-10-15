/*
  What the updated RSI PRD asks an improvement to know about the agent before
  and after it searches, kept apart from the search itself so the engine's
  draws stay where they are:

  · the repository's own tests, a static check on code candidates
  · members (one can be targeted, protected ones are never changed) and the
    channels an agent serves, so a proposal says which it didn't check
  · contract-changing candidates — a new tool or tool parameter can't be
    proven on the frozen environment version
  · voice in text: search in text, confirm finalists as real calls
  · the agent's state and main environment, and re-reading it at the start —
    read through other modules' helpers when they exist

  Helpers from rsiModel and agentSync are read off their namespaces so this
  works before, and after, those exports land.
*/
import * as rsi from "./rsiModel";
import * as sync from "./agentSync";
import { definitionOf } from "./agentRegistry";
import { hashSeed } from "./runStream";

/* ── the repository's own tests ─────────────────────────────────────────── */

/** The test command a code candidate must still pass, or null when there's no repository. */
export const repoTestsOf = (agent) => {
  const v = agent?.values || {};
  /* Stored as { command, checks } by the connect flow; a bare string is the command. */
  if (v.repoTests) return typeof v.repoTests === "string" ? v.repoTests : v.repoTests.command || null;
  const d = definitionOf(agent) || {};
  return d.kind === "repo" || (d.kind === "framework" && d.repoUrl) ? "pytest tests/" : null;
};

/* ── the agent's state and main environment ─────────────────────────────── */

/**
 * Connected, disconnected or archived, with the reason — from rsiModel when it
 * has it. An agent we know nothing about reads as connected.
 */
export const agentStatusFor = (agent) => {
  if (!agent) return { key: "connected" };
  if (typeof rsi.agentStatusOf === "function") {
    try {
      const s = rsi.agentStatusOf(agent);
      if (s) return { ...s, key: s.status || s.key || "connected" };
    } catch (e) { /* fall through */ }
  }
  if (agent.archived || agent.archivedAt) return { key: "archived", reason: "This agent is archived." };
  if (agent.disconnected || agent.values?.disconnected) return { key: "disconnected", reason: "This agent is disconnected." };
  return { key: "connected" };
};

/** The environment an improvement runs in by default — the agent's main one. */
export const mainEnvFor = (agent, state, envs = []) => {
  if (typeof rsi.mainEnvOf === "function") {
    try {
      const m = rsi.mainEnvOf(agent, state);
      const id = typeof m === "string" ? m : m?.envId || m?.id || m?.env?.id;
      const found = envs.find((e) => e.id === id);
      if (found) return found;
    } catch (e) { /* fall through */ }
  }
  return envs[0] || null;
};

/**
 * Re-read the agent as the improvement starts, so the baseline is what runs in
 * production. { changed, version: label|null, reason? }, or null when nothing
 * can re-read it. `versionRecord` is what the caller saves on the agent.
 */
export const rereadFor = (agent, state) => {
  if (!agent || typeof sync.rereadAgent !== "function") return null;
  try {
    const r = sync.rereadAgent(agent, state || {});
    if (!r) return null;
    const label = r.label || (typeof r.version === "string" ? r.version : r.version?.label) || null;
    return {
      changed: !!r.changed,
      version: r.changed ? label : null,
      ...(r.reason && { reason: r.reason }),
      ...(r.changed && r.version && typeof r.version === "object" && { versionRecord: r.version }),
    };
  } catch (e) {
    return null;
  }
};

/** The re-read as stored on the record — without the version record itself. */
export const rereadStamp = (reread) => (reread ? { changed: reread.changed, version: reread.version, ...(reread.reason && { reason: reread.reason }) } : null);

/** The first line of the search trace. */
export const rereadLine = (reread) => {
  if (!reread) return null;
  return reread.changed
    ? `Changed outside Future AGI → baseline on ${reread.version || "the new version"}`
    : "Re-read the agent — no outside change";
};

/* ── members and channels ────────────────────────────────────────────────── */

/** The agent's members — specialists, sub-agents, the parts of a team. */
export const membersOf = (agent) => {
  const d = definitionOf(agent) || {};
  const list = d.members || agent?.definition?.members || agent?.values?.members || [];
  return list.map((m, i) => (typeof m === "string" ? { id: m, name: m } : { id: m.id || m.name || `member-${i}`, name: m.name || m.label || m.id, ...m }));
};

const protectedSet = (limits) => new Set((limits?.protectedMembers || []).map(String));
export const isProtectedMember = (m, limits) => {
  const p = protectedSet(limits);
  return p.has(String(m.id)) || p.has(String(m.name));
};

/** Members an improvement may target — never a protected one. */
export const targetableMembers = (agent, limits) => membersOf(agent).filter((m) => !isProtectedMember(m, limits));

/* Kinds of change that sit in parts every member and channel shares. */
const SHARED_KINDS = ["Tool description", "Architecture", "Tool code", "Model"];

/**
 * Which member each proposal changes. A targeted improvement changes the
 * target; otherwise each change lands on the member its scenarios ran
 * through. Protected members are never changed — a change that would touch
 * one is read as a shared-part change instead. With no members, every change
 * is to the one agent, which every channel shares.
 */
export const proposalMembers = (proposals = [], { agent, limits, target } = {}) => {
  const members = membersOf(agent);
  const open = members.filter((m) => !isProtectedMember(m, limits));
  const targeted = target ? open.find((m) => m.id === target || m.name === target) : null;
  return Object.fromEntries(proposals.map((p) => {
    if (!members.length) return [p.id, { member: null, shared: true }];
    if (SHARED_KINDS.includes(p.kind)) return [p.id, { member: null, shared: true }];
    if (targeted) return [p.id, { member: targeted, shared: false }];
    if (!open.length) return [p.id, { member: null, shared: true }];
    const h = hashSeed(`member:${p.id}`);
    return [p.id, h % 4 === 0 ? { member: null, shared: true } : { member: open[h % open.length], shared: false }];
  }));
};

/** The members a set of proposals changes, by name — "Refunds specialist, Router". */
export const membersChanged = (proposals, ctx) => {
  const map = proposalMembers(proposals, ctx);
  const names = [...new Set(Object.values(map).filter((x) => x.member).map((x) => x.member.name))];
  const shared = Object.values(map).some((x) => x.shared);
  return { names, shared, hasMembers: membersOf(ctx?.agent).length > 0 };
};

/** The channels an agent serves — voice, chat, sms… */
export const channelsOf = (agent, fallback) => {
  if (typeof rsi.agentChannelsOf === "function" && agent) {
    try { return rsi.agentChannelsOf(agent); } catch (e) { /* fall through */ }
  }
  const list = agent?.values?.channels || agent?.channels || [];
  return list.length ? list : fallback ? [fallback] : [];
};

const CHANNEL_WORD = { voice: "voice", chat: "chat", sms: "SMS", email: "email", web: "web chat" };

/**
 * The channels a proposal touching shared parts did not check — one note per
 * channel no checked environment covers. Empty when the agent serves one
 * channel, or when every channel it serves was checked.
 */
export const uncheckedChannelNotes = (agent, checkedSurfaces = []) => {
  const channels = channelsOf(agent);
  if (channels.length < 2) return [];
  const checked = new Set(checkedSurfaces.map((s) => (s === "browser" ? "web" : s)));
  return channels
    .filter((c) => !checked.has(c))
    .map((c) => `Not checked on ${CHANNEL_WORD[c] || c} — no ${CHANNEL_WORD[c] || c} environment`);
};

/* ── contract-changing candidates ────────────────────────────────────────── */

const PARAM_FOR = [
  [/book|reserve|schedule|create/i, "preferred_time"],
  [/refund/i, "reason_code"],
  [/cancel/i, "cancel_reason"],
  [/rebook|change|modify|update/i, "keep_seat"],
  [/verify|identity|auth/i, "second_factor"],
  [/lookup|status|get|search|check/i, "include_history"],
];

/**
 * A candidate the search wrote but cannot prove: it adds a parameter to a
 * tool, which changes the environment's contract. Only code agents can add
 * one, and only for a tool the failing scenarios needed.
 */
export const contractCandidateOf = ({ env, allowed = [], failing = [] }) => {
  if (!allowed.includes("code")) return null;
  const tools = env?.tools || [];
  if (!tools.length) return null;
  const counts = new Map();
  failing.forEach((t) => (t.callLog?.missing || []).forEach((n) => counts.set(n, (counts.get(n) || 0) + 1)));
  const [name, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const tool = tools.find((t) => t.name === name) || null;
  if (!tool) return null;
  const param = (PARAM_FOR.find(([re]) => re.test(tool.name)) || [null, "context"])[1];
  return {
    id: `contract-${tool.name}-${param}`,
    kind: "Tool description",
    tool: tool.name,
    param,
    title: `Add a ${param} parameter to ${tool.name}`,
    why: `${n} failing ${n === 1 ? "scenario" : "scenarios"} needed ${tool.name} and couldn't pass what the caller said into it.`,
    diff: [{ type: "add", text: `${tool.name}(…, ${param})` }],
    contract: true,
  };
};

/** The sentence a contract-changing candidate gets on the improvement page. */
export const contractMessage = (c, envVersion = "the frozen version") => `This change adds a parameter to ${c.tool}. It can't be proven on environment ${envVersion}. Approve a new environment version with the new contract, and the baseline runs again on it before any comparison.`;

/* ── voice in text ───────────────────────────────────────────────────────── */

/**
 * Voice agents search in text by default — trials run as text conversations,
 * and only the finalists are confirmed as real calls. The switch on the fix
 * sheet and improvement setup turns it off for every-trial-a-real-call.
 */
export const textSearchDefault = (surface) => surface === "voice";

/* ── shipping on hosted platforms ────────────────────────────────────────── */

/** Retell: are the live numbers pinned to a released version? */
export const retellPinnedOf = (agent) => {
  if (agent?.values?.provider !== "retell") return null;
  if (typeof rsi.retellPinStateOf === "function") {
    try {
      const st = rsi.retellPinStateOf(agent);
      if (st) return st;
    } catch (e) { /* fall through */ }
  }
  const pinned = !!(agent.values.retellNumbersPinned?.at || agent.values.retellNumbersPinned === true);
  return { pinned, line: pinned ? "Live numbers pinned to a released version" : "Live numbers follow the newest version" };
};

/** ElevenLabs: is versioning switched on for the agent? Branches need it. */
export const elevenlabsVersioningOn = (agent) => !!(agent?.values?.versioning?.at || agent?.values?.versioning === true || agent?.values?.versioningOn);
