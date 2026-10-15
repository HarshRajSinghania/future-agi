/*
  An agent's constraints — what an improvement may change and what it must
  not move. Kept per agent, so every improvement for it (from the Error Feed,
  from Debug failures, from a goal) is held to the same rules.
*/
import { useCallback, useMemo } from "react";
import { useSimStore } from "../store";
import { DEFAULT_LIMITS, PER_CONVERSATION } from "../_mock/optimizationRuns";
import { definitionOf, sourceKindOf } from "../_mock/agentRegistry";

/*
  Automatic improvements — off until someone turns them on, and when on, the
  most a run may do without a person: propose, open a draft, or (where the
  platform can split traffic) try the draft on a share of calls. Full release
  is never one of them.
*/
export const DEFAULT_SCHEDULE = { mode: "off", day: "mon", time: "09:00", autonomy: "propose" };

/** The agent's constraints, or the safe defaults where it hasn't set one. */
export const limitsOf = (state, agentKey) => {
  const own = state?.agentLimits?.[agentKey] || {};
  return {
    ...DEFAULT_LIMITS,
    ...own,
    /* A percentage above today's agent, unless it names a fixed amount. */
    costMode: own.costMode === "abs" ? "abs" : "pct",
    model: { ...DEFAULT_LIMITS.model, ...(own.model || {}) },
    budget: { ...DEFAULT_LIMITS.budget, ...(own.budget || {}) },
    schedule: { ...DEFAULT_SCHEDULE, ...(own.schedule || {}) },
    /* Speech providers a candidate may switch to (names, e.g. "Deepgram"),
       with the ones in use today. Empty: it stays on today's providers. */
    approvedSpeech: Array.isArray(own.approvedSpeech) ? own.approvedSpeech : [],
    /* Rules inside an area — off until someone allows them. */
    areaRules: { whoSpeaksFirst: false, toolsAddRemove: false, ...(own.areaRules || {}) },
  };
};

export const SCHEDULE_DAYS = [
  { id: "mon", label: "Monday", js: 1 },
  { id: "tue", label: "Tuesday", js: 2 },
  { id: "wed", label: "Wednesday", js: 3 },
  { id: "thu", label: "Thursday", js: 4 },
  { id: "fri", label: "Friday", js: 5 },
  { id: "sat", label: "Saturday", js: 6 },
  { id: "sun", label: "Sunday", js: 0 },
];

/** The next weekly run after `now`, as a Date. */
export const nextScheduledAt = (schedule, now = new Date()) => {
  const day = SCHEDULE_DAYS.find((d) => d.id === schedule?.day) || SCHEDULE_DAYS[0];
  const [h, m] = String(schedule?.time || DEFAULT_SCHEDULE.time).split(":").map(Number);
  const at = new Date(now);
  at.setHours(h || 0, m || 0, 0, 0);
  at.setDate(at.getDate() + ((day.js - at.getDay() + 7) % 7));
  if (at <= now) at.setDate(at.getDate() + 7);
  return at;
};

/** "Mon 13 Oct, 09:00" — a scheduled time, said the same way everywhere. */
export const scheduleTimeLabel = (date) => {
  const d = new Date(date);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/*
  A canary needs the platform to send a share of calls to the draft while the
  rest stay on today's version. Vapi and Retell can; nothing else we connect
  to can yet, so the cap stops at drafts there. Canary release itself isn't
  built yet — nothing deploys on its own — so it's shown "Coming soon", not
  picked.
*/
export const canarySupported = (agent) => ["vapi", "retell"].includes(agent?.values?.provider);

/** The newest improvement a schedule started for this agent, in any of its environments. */
export const lastAutomaticRun = (state, agent) => (agent?.usedIn || [])
  .flatMap((u) => (state?.byEnv?.[u.envId]?.optimizations || [])
    .filter((o) => o.trigger?.kind === "schedule")
    .map((record) => ({ envId: u.envId, es: state.byEnv[u.envId], record })))
  .sort((a, b) => (Date.parse(b.record.createdAt || 0) || 0) - (Date.parse(a.record.createdAt || 0) || 0))[0] || null;

/* What a conversation costs today, from the surface of an environment it
   runs in — null until it runs in one. */
export const measuredCostOf = (state, agent) => {
  const surface = (agent?.usedIn || [])
    .map((u) => (state?.myEnvironments || []).find((e) => e.id === u.envId)?.surface)
    .find(Boolean);
  return surface ? PER_CONVERSATION[surface === "voice" ? "voice" : "chat"] : null;
};

/**
 * Which kinds of change this agent can take at all. Code and structure need
 * its code (a repository or an upload); settings need a platform that holds
 * them. Anything else is said, not hidden.
 */
/** A repository linked to an agent that isn't read from one — where its code lives. */
export const linkedRepoOf = (agent) => definitionOf(agent).repoUrl || agent?.values?.repoUrl || agent?.values?.linkedRepo || null;

export const surfaceAvailability = (agent) => {
  const kind = sourceKindOf(agent);
  /* Code changes need the code: a repository agent, an upload, a framework
     agent — or a hosted or built-in agent whose tools live in a linked repo. */
  const code = kind === "repo" || kind === "upload" || kind === "framework" || !!linkedRepoOf(agent);
  return {
    prompt: { ok: true },
    tools: { ok: kind !== "endpoint" },
    /* Settings we can change: a hosted platform's config, or our own for an
       agent built here. */
    settings: { ok: kind === "platform" || kind === "builtin", why: "Only a hosted platform or an agent built in Future AGI exposes settings to change" },
    code: { ok: code, why: "Needs the agent's code — connect it from a repository" },
    structure: { ok: code, why: "Needs the agent's code — connect it from a repository" },
    /* Tool code is the world's — a change to it is re-proved as a world
       change before it's compared. Needs the repository the tools live in. */
    toolcode: { ok: code, why: "Needs the repository the tool handlers live in" },
  };
};

export function useAgentLimits(agentKey) {
  const { state, dispatch } = useSimStore();
  const limits = useMemo(() => limitsOf(state, agentKey), [state, agentKey]);
  const set = useCallback((patch) => dispatch({ type: "setAgentLimits", agentKey, limits: { ...limitsOf(state, agentKey), ...patch } }), [dispatch, state, agentKey]);
  const reset = useCallback(() => dispatch({ type: "setAgentLimits", agentKey, limits: DEFAULT_LIMITS }), [dispatch, agentKey]);
  return { limits, set, reset, custom: !!state?.agentLimits?.[agentKey] };
}
