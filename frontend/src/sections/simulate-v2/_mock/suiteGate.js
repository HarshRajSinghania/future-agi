/**
 * Scenario quality review (PRD v7 §4.10.9; was "can this suite gate
 * releases?" in v6 — the harness never gates, promotes or ships an agent
 * version, so the review is about the scenarios, not a release).
 *
 * Whether the scenario set is worth trusting. Three things, all on the S
 * version as it stands:
 *
 *   admission   every live scenario passes the quality gate — the
 *               quarantined ones are listed, to rewrite or archive
 *   spot-check  a person reads a sample (~10) and marks each "realistic and
 *               the checks are right" or "not right"; agreement ≥ 90%
 *   coverage    every rule the environment enforces has an admitted
 *               scenario testing it (coverage.js `ruleCoverage`)
 *
 * Needs work → Spot-check needed → Reviewed.
 *
 * Spot-check answers live on envState per suite version:
 *   envState.suiteSpotChecks = { [suiteVersion]: { answers: { [id]: answer } } }
 *   answer = { verdict: "right" | "not-right", note, fp, at, by }
 * A new suite version starts a new check, carrying forward the answers for
 * scenarios that haven't changed (same fingerprint). An edited scenario is
 * read again.
 *
 * Canaries have no legitimate solution by design — they take the quality
 * gate but aren't sampled or counted toward rule coverage.
 *
 * Pure. The export names are kept from v6 (`suiteGateOf`, `SUITE_GATE_STATES`)
 * so anything already reading them still works.
 */
import { admissionOf, ruleCoverage } from "./coverage";
import { currentSuiteLabel as suiteVersionOf } from "./suiteLog";
import { currentEnvVersion, versionNumber } from "./versions";

export const SPOT_CHECK_SIZE = 10;
export const AGREEMENT_BAR = 0.9;

export const SUITE_GATE_STATES = {
  "not-ready": { label: "Needs work" },
  "spot-check": { label: "Spot-check needed" },
  ready: { label: "Reviewed" },
};

const hash = (s = "") => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/* What a reviewer read. Change any of it and the answer is about a different
   scenario. */
export const fingerprintOf = (row) => String(hash(JSON.stringify([
  row?.title, row?.task, row?.expected, row?.idealOutcome, row?.persona?.name,
  (row?.subGoals || []).map((g) => (typeof g === "string" ? g : g?.text || g?.label || g?.id)),
  row?.editedAt || null,
])));

const suiteNumber = (v) => Number(String(v || "").replace(/^s/, "")) || 0;

/* The rows the suite is, on the pinned environment version: live, and not
   added on a later version. */
const suiteRows = (env, envState) => {
  const label = env ? currentEnvVersion(env, envState)?.label : null;
  return (envState?.scenarios || []).filter((r) => !r.retired && !r.archived
    && !(r.addedInEnv && label && versionNumber(r.addedInEnv) > versionNumber(label)));
};

/* The failure mode the pack wrote into the id — the sample spreads across them. */
const modeOf = (id = "") => (id.match(/-(core|rule|trap|adversarial|edge)-/) || [])[1] || "core";

/**
 * A spread sample of admitted scenarios: round-robin across failure modes,
 * each mode in a stable hashed order — so the same scenario is picked again
 * next version unless it changed or left.
 */
export const spotCheckSample = (rows, size = SPOT_CHECK_SIZE) => {
  const byMode = new Map();
  [...rows]
    .sort((a, b) => hash(`spot:${a.id}`) - hash(`spot:${b.id}`))
    .forEach((r) => {
      const m = modeOf(r.id);
      if (!byMode.has(m)) byMode.set(m, []);
      byMode.get(m).push(r);
    });
  const queues = [...byMode.values()];
  const out = [];
  while (out.length < size && queues.some((q) => q.length)) {
    queues.forEach((q) => { if (out.length < size && q.length) out.push(q.shift()); });
  }
  return out;
};

/**
 * The answers for this suite version: what's stored for it, else what the
 * latest earlier version recorded for scenarios that haven't changed.
 * Carried answers keep `carriedFrom`. → { answers }
 */
export const spotCheckAnswers = (envState, suiteVersion, rows) => {
  const all = envState?.suiteSpotChecks || {};
  if (all[suiteVersion]) return { answers: all[suiteVersion].answers || {} };
  const earlier = Object.keys(all)
    .filter((v) => suiteNumber(v) < suiteNumber(suiteVersion))
    .sort((a, b) => suiteNumber(b) - suiteNumber(a));
  const from = earlier[0];
  if (!from) return { answers: {} };
  const fpById = new Map(rows.map((r) => [r.id, fingerprintOf(r)]));
  const answers = {};
  Object.entries(all[from].answers || {}).forEach(([id, a]) => {
    if (a && fpById.get(id) === a.fp) answers[id] = { ...a, carriedFrom: a.carriedFrom || from };
  });
  return { answers };
};

/**
 * The gate. → { state, label, reason, admitted, total, agreement, sampled,
 *   answered, agreed, quarantined, coverage, suiteVersion, sample, answers,
 *   carried, carriedFrom, bar }
 * `agreement` is agreed / answered (null until something is answered);
 * `sampled` is the sample's size.
 */
export const suiteGateOf = (env, envState) => {
  const suiteVersion = suiteVersionOf(envState);
  const rows = suiteRows(env, envState);
  const verdicts = rows.map((r) => ({ row: r, adm: admissionOf(r, env) }));
  const admittedRows = verdicts.filter((v) => v.adm.admitted).map((v) => v.row);
  const quarantined = verdicts.filter((v) => !v.adm.admitted).map((v) => ({
    id: v.row.id, name: v.row.name || v.row.title || v.row.id, reason: v.adm.reason, gate: v.adm.gate || null,
  }));

  /* Coverage: every rule has an admitted scenario testing it. A canary
     tests nothing on purpose. */
  const counted = admittedRows.filter((r) => !r.canary);
  const rules = ruleCoverage(env, counted);
  const uncovered = rules.filter((r) => r.count === 0).map((r) => r.rule);
  const coverage = { rules: rules.length, covered: rules.length - uncovered.length, uncovered };

  const sample = spotCheckSample(counted);
  const { answers: stored } = spotCheckAnswers(envState, suiteVersion, rows);
  /* Only answers about the sample, and only while the scenario reads the same. */
  const answers = {};
  sample.forEach((r) => {
    const a = stored[r.id];
    if (a && a.fp === fingerprintOf(r)) answers[r.id] = a;
  });
  const answered = Object.keys(answers).length;
  const agreed = Object.values(answers).filter((a) => a.verdict === "right").length;
  const agreement = answered ? agreed / answered : null;
  const sampled = sample.length;
  const carriedHere = Object.values(answers).filter((a) => a.carriedFrom).length;

  const base = {
    suiteVersion,
    admitted: admittedRows.length,
    total: rows.length,
    quarantined,
    coverage,
    sample: sample.map((r) => r.id),
    sampled,
    answers,
    answered,
    agreed,
    agreement,
    /* Answers this version took over from an earlier one, unchanged. */
    carried: carriedHere,
    carriedFrom: carriedHere ? Object.values(answers).find((a) => a.carriedFrom)?.carriedFrom || null : null,
    bar: AGREEMENT_BAR,
  };
  const out = (state, reason) => ({ ...base, state, label: SUITE_GATE_STATES[state].label, reason });

  if (!rows.length) return out("not-ready", "No scenarios in this suite yet.");
  if (quarantined.length) {
    return out("not-ready", `${quarantined.length} quarantined — ${quarantined.length === 1 ? "it fails" : "they fail"} the quality gate. Rewrite or archive ${quarantined.length === 1 ? "it" : "them"}.`);
  }
  if (uncovered.length) {
    return out("not-ready", `${uncovered.length} rule${uncovered.length === 1 ? " has" : "s have"} no admitted scenario — "${uncovered[0]}"${uncovered.length > 1 ? ` and ${uncovered.length - 1} more` : ""}.`);
  }
  if (answered < sampled) {
    return out("spot-check", answered
      ? `${answered} of ${sampled} spot-checked — mark the rest to finish.`
      : `Spot-check ${sampled} scenarios — a person agrees they're realistic and their checks are right.`);
  }
  if (agreed / sampled < AGREEMENT_BAR) {
    return out("spot-check", `${Math.round((agreed / sampled) * 100)}% agreement — below the ${Math.round(AGREEMENT_BAR * 100)}% bar. Fix the ones marked not right, then check them again.`);
  }
  return out("ready", `Every scenario passes the quality gate, every rule is covered, ${Math.round((agreed / sampled) * 100)}% spot-check agreement.`);
};

/**
 * Record one spot-check answer on the current suite version. Writes the
 * carried-forward answers too, so the version's record stands on its own.
 * `verdict` null clears the answer. → the envState patch.
 */
export const recordSpotCheck = (env, envState, scenarioId, { verdict, note = "", by = null } = {}) => {
  const suiteVersion = suiteVersionOf(envState);
  const rows = suiteRows(env, envState);
  const row = rows.find((r) => r.id === scenarioId);
  const { answers } = spotCheckAnswers(envState, suiteVersion, rows);
  const next = { ...answers };
  if (!verdict || !row) delete next[scenarioId];
  else next[scenarioId] = { verdict, note: verdict === "not-right" ? note : "", fp: fingerprintOf(row), at: new Date().toISOString(), by };
  return {
    suiteSpotChecks: {
      ...(envState?.suiteSpotChecks || {}),
      [suiteVersion]: { answers: next },
    },
  };
};
