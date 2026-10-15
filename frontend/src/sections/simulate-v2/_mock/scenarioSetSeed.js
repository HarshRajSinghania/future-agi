/*
  The PRD v7 scenario-set fields a seeded environment starts with: tiers
  (anchor core seeded from the scenarios written critical, plus a spread
  across use cases), its impossible-scenario canaries, and the off-limits
  tools and paths it declares. Shared by the seed and by the top-up that
  brings an older saved copy forward — which fills only what's missing and
  never writes over an edit.

  Scenario versions need no seeding: a row without one is 1.0.0.
*/
import { withSeedTiers } from "./tiers";
import { seedCanariesFor, seedOffLimitsFor } from "./cheatControls";
import { migrateRetired } from "./scenarioStates";
import { failingCaseVariations } from "./scenarioSources";

export const withScenarioSetSeed = (envId, es) => {
  if (!es) return es;
  const rows = (es.scenarios || []).map(migrateRetired);
  const canaries = seedCanariesFor(envId, rows);
  const offLimits = es.offLimits || seedOffLimitsFor(envId);
  return {
    ...es,
    scenarios: withSeedTiers([...rows, ...canaries]),
    ...(offLimits.length && { offLimits }),
  };
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
  const sources = (es.scenarios || []).filter((r) => !r.canary && !r.archived && /-core-\d+-/.test(r.id)).slice(0, 2);
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
