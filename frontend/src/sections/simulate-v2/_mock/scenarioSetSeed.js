/*
  What a seeded environment's scenario set is read through, shared by the seed
  and by the top-up that brings an older saved copy forward: a retired
  scenario reads as archived, and rows from the removed cheat checks (the
  impossible-by-design "canary" scenarios) are dropped, so nobody sees them as
  scenarios that always fail. Never writes over an edit.

  Scenario versions need no seeding: a row without one is 1.0.0.
*/
import { migrateRetired } from "./scenarioStates";
import { failingCaseVariations } from "./scenarioSources";

/** Rows from the removed cheat checks — never shown, never run. */
export const isRetiredCheckRow = (row) => !!row?.canary || /-canary-\d+$/.test(String(row?.id || ""));

export const withScenarioSetSeed = (envId, es) => {
  if (!es) return es;
  return { ...es, scenarios: (es.scenarios || []).filter((r) => !isRetiredCheckRow(r)).map(migrateRetired) };
};

/** A stored environment we didn't seed: only `retired` becomes `archived`. */
export const withArchivedMigration = (es) => (es?.scenarios?.some((r) => r.retired)
  ? { ...es, scenarios: es.scenarios.map(migrateRetired) }
  : es);

/*
  Seed 17 (RSI PRD): the support line's scheduled improvement wrote four
  scenarios of its own — variations of two scenarios it was fixing — that
  aren't in the environment yet, so the Scenarios tab's "from improvements"
  strip and the improvement page have something to add. Kept on the record
  as `issueScenarios` (_mock/improvementScenarios.js); filled only where the
  record has none, never over anything someone added or removed.
*/
export const IMPROVEMENT_SEED_ENV = "env-voice-support";

export const withImprovementScenarioSeed = (envId, es, env) => {
  if (envId !== IMPROVEMENT_SEED_ENV || !es || !env) return es;
  const records = es.optimizations || [];
  const i = records.findIndex((o) => o.trigger?.kind === "schedule");
  if (i < 0 || records[i].issueScenarios) return es;
  const record = records[i];
  const sources = (es.scenarios || []).filter((r) => !isRetiredCheckRow(r) && !r.archived && /-core-\d+-/.test(r.id)).slice(0, 2);
  const rows = sources.flatMap((src) => failingCaseVariations(
    { id: `from-improvement::${record.id}::${src.id}`, name: src.name, title: src.title, batchNote: `from ${record.name || record.id}` },
    { source: src, env, envState: es, count: 2 },
  ).map((v) => ({
    ...v,
    source: "improvement",
    fromImprovement: { id: record.id, name: record.name || record.id },
    summary: `Written by ${record.name || record.id} · ${v.summary}`,
  })));
  if (!rows.length) return es;
  return { ...es, optimizations: records.map((o, j) => (j === i ? { ...o, issueScenarios: rows } : o)) };
};
