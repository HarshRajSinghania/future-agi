/*
  A scenario's version and the pin a run records. Kept in its own leaf module
  so envModel can record the pin without importing decoupled (which reads
  envModel's rule impact) — the two used to import each other.
*/

/** A scenario row's current version; rows from before versions existed are 1.0.0. */
export const scenarioVersionOf = (row) => row?.version || "1.0.0";

/** The pin a new run records: each live scenario's version. */
export const scenarioVersionsPin = (envState) => Object.fromEntries((envState?.scenarios || [])
  .filter((r) => !r.archived && !r.retired)
  .map((r) => [r.id, scenarioVersionOf(r)]));
