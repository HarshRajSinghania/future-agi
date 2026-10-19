/*
  An agent's constraints, read without the store — what the Constraints tab
  edits (agentLimits.js) and what the improvement scheduler reads
  (_mock/scheduledImprovements.js), which runs inside the store itself.
*/
import { DEFAULT_LIMITS } from "../_mock/optimizationRuns";

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
