/*
  Scenario tiers within S — PRD v7 §4.10.8, §4.10.9, AC-9.21.

    anchor       Anchor core: a frozen slice (15–25 at today's suite sizes)
                 that is never silently removed. Archiving an anchor, or
                 marking it not applicable, is an explicit, logged decision.
    core         The pinned regression set.
    exploration  New capabilities, red-team and coverage growth. Its results
                 show separately. Generated, production and failure-cluster
                 scenarios land here.

  Stored as `row.tier`; a row without one is core. The old `critical` field
  stays on rows for compatibility — it seeds the anchor, nothing more.

  Anchor decisions are kept on envState.anchorLog:
    [{ id, at, kind, scenarioId, name, note, by }]
    kind: "pin" | "unpin" | "archive" | "not-applicable"
*/

export const TIERS = {
  anchor: { label: "Anchor", long: "Anchor core", note: "Frozen — never silently removed. Archiving it or marking it not applicable is logged." },
  core: { label: "Core", long: "Core", note: "The pinned regression set." },
  exploration: { label: "Exploration", long: "Exploration", note: "New capabilities, red-team and coverage growth — its results show separately." },
};

export const TIER_ORDER = ["anchor", "core", "exploration"];

/** The filter's tier choices, in order. */
export const TIER_CHOICES = TIER_ORDER.map((t) => TIERS[t].long);

export const tierOf = (row) => (TIERS[row?.tier] ? row.tier : "core");
export const isAnchor = (row) => tierOf(row) === "anchor";

/* At today's sizes the anchor is 15–25; a small suite keeps about a third. */
export const ANCHOR_MIN = 8;
export const ANCHOR_MAX = 25;
const anchorTarget = (n) => Math.max(Math.min(ANCHOR_MIN, n), Math.min(ANCHOR_MAX, Math.round(n * 0.3)));

/* Sources that arrive as proposals (AC-9.22) — they land in exploration. */
export const PROPOSAL_SOURCES = new Set(["generated", "error-feed", "failing-case", "production"]);

const kindOf = (id = "") => (id.match(/-(core|rule|trap|adversarial|edge|canary)-/) || [])[1] || null;

/*
  The seed's anchor: the scenarios that were written critical (one per rule,
  one per critical data trap, the first adversarial probe) and one routine
  call per tool, taken round-robin so the slice spreads across use cases.
  Exploration: the edges and the further red-team probes. The rest is core.
  Deterministic on the row ids — the same suite seeds the same tiers.
*/
export const seedTiersFor = (rows = []) => {
  const live = rows.filter((r) => !r.canary);
  const firstOf = (re) => {
    const seen = new Set();
    return live.filter((r) => {
      const m = String(r.id).match(re);
      if (!m || seen.has(m[1])) return false;
      seen.add(m[1]);
      return true;
    });
  };
  const queues = [
    firstOf(/-rule-(\d+)-/).filter((r) => r.critical),
    live.filter((r) => /-core-\d+-routine$/.test(r.id)),
    firstOf(/-trap-(\d+)-/).filter((r) => r.critical),
    live.filter((r) => /-adversarial-0$/.test(r.id)),
  ];
  const target = anchorTarget(live.length);
  const anchors = new Set();
  while (anchors.size < target && queues.some((q) => q.length)) {
    queues.forEach((q) => { if (anchors.size < target && q.length) anchors.add(q.shift().id); });
  }
  return new Map(rows.map((r) => {
    if (anchors.has(r.id)) return [r.id, "anchor"];
    if (PROPOSAL_SOURCES.has(r.source)) return [r.id, "exploration"];
    const k = kindOf(r.id);
    if (k === "edge" || (k === "adversarial" && !/-adversarial-0$/.test(r.id))) return [r.id, "exploration"];
    return [r.id, "core"];
  }));
};

/** Rows with a seeded tier wherever they have none — never over one set by hand. */
export const withSeedTiers = (rows = []) => {
  const tiers = seedTiersFor(rows);
  return rows.map((r) => (r.tier ? r : { ...r, tier: tiers.get(r.id) || "core" }));
};

/* ── the anchor log ──────────────────────────────────────────────────────── */

export const ANCHOR_LOG_KIND = {
  pin: "Pinned to anchor core",
  unpin: "Moved out of anchor core",
  archive: "Archived an anchor",
  "not-applicable": "Marked an anchor not applicable",
};

export const anchorLogOf = (envState) => envState?.anchorLog || [];

/** The log entries for one scenario, newest first. */
export const anchorLogFor = (envState, id) => anchorLogOf(envState).filter((e) => e.scenarioId === id).reverse();

/** Patch that logs anchor decisions — one per row. */
export const anchorLogPatch = (envState, rows, kind, { note = "", by = null } = {}) => ({
  anchorLog: [
    ...anchorLogOf(envState),
    ...rows.map((r, i) => ({
      id: `anc-${Date.now().toString(36)}-${i}`,
      at: new Date().toISOString(),
      kind,
      scenarioId: r.id,
      name: r.name || r.title || r.id,
      note: note || null,
      by,
    })),
  ],
});

/**
 * Of these scenario ids, the anchors — for anything that would mark them not
 * applicable (an approved Remove nudge) and so has to log it.
 */
export const anchorsAmong = (envState, ids = []) => {
  const want = new Set(ids);
  return (envState?.scenarios || []).filter((r) => want.has(r.id) && isAnchor(r));
};

/** "20 anchor · 41 core · 7 exploration" counts, over the rows given. */
export const tierCounts = (rows = []) => {
  const out = { anchor: 0, core: 0, exploration: 0 };
  rows.forEach((r) => { out[tierOf(r)] += 1; });
  return out;
};
