/*
  A scenario's priority — High, Med or Low. It decides what a quick run takes
  (every high-priority scenario) and, when a run is capped, which scenarios
  go first. It is not a gate: must-pass is the gate, and a must-pass
  scenario is always high.

  A scenario nobody has set reads from what the set already says about it —
  the anchor core is high, exploration and proposed scenarios are low — and
  the rest spread by id, so the seeded sets show all three.
*/
import { tierOf } from "./tiers";

export const PRIORITIES = [
  { id: "high", label: "High" },
  { id: "med", label: "Med" },
  { id: "low", label: "Low" },
];
export const PRIORITY_LABEL = { high: "High", med: "Med", low: "Low" };
export const PRIORITY_RANK = { high: 0, med: 1, low: 2 };
export const PRIORITY_NOTE = "A quick run takes high-priority scenarios from every use case, up to 30; a capped run fills by priority. Must-pass is separate — and always high.";

const spread = (id = "") => {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const n = h % 20;
  return n < 5 ? "high" : n < 14 ? "med" : "low";
};

export const priorityOf = (row) => {
  if (!row) return "med";
  if (row.critical) return "high";
  if (row.priority && PRIORITY_LABEL[row.priority]) return row.priority;
  const tier = tierOf(row);
  if (tier === "anchor") return "high";
  if (tier === "exploration" || row.proposed) return "low";
  return spread(row.id);
};

export const withPriority = (row, priority) => ({ ...row, priority });

export const QUICK_RUN_CAP = 30;

/*
  What a quick run takes: high-priority scenarios, must-pass first, picked
  in turn from each use case so every one is represented — at most
  QUICK_RUN_CAP, the "smoke set".
*/
export const quickRunIdsOf = (rows, cap = QUICK_RUN_CAP) => {
  const groups = new Map();
  rows.filter((r) => !r.archived && !r.canary && priorityOf(r) === "high").forEach((r) => {
    const key = r.useCase || r.branchCategory || "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  const queues = [...groups.values()].map((list) => [...list].sort((a, b) => (b.critical ? 1 : 0) - (a.critical ? 1 : 0)));
  const ids = [];
  for (let round = 0; ids.length < cap && queues.some((q) => q.length > round); round += 1) {
    queues.forEach((q) => { if (ids.length < cap && q[round]) ids.push(q[round].id); });
  }
  return ids;
};
