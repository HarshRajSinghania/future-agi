/*
  Where an improvement opens.

  Improvements is three levels: every improvement (one trigger, one search)
  → that improvement's page, the runs it tried (compare, choose winner) →
  a run's own page. From any list, and from a run's "From Improvement N",
  an improvement opens on its own page.
*/
import { paths } from "src/routes/paths";
import { rejectedFor } from "../_mock/optimizer";

/** The improvement's own page — while it searches, or when nothing ran.
    (paths.js has no helper for this route yet — move it there when it does.) */
export const improvementPath = (envId, optId) => `${paths.dashboard.simulate.improvements}/${envId}/${optId}`;

/** A connected agent's page, optionally on one of its tabs (connections,
    constraints…). Same caveat: no paths.js helper for this route yet. */
export const connectedAgentPath = (agentId, tab) =>
  `${paths.dashboard.agents}/connected/${agentId}${tab ? `?tab=${tab}` : ""}`;

/**
 * The run an improvement resolves to: its winner run on the full suite once
 * there is one — the only run of it comparable to any other — else the trial
 * it kept, else its best trial.
 */
export const improvementRunId = (record, envState = null) => {
  if (!record || record.status === "running") return null;
  const verified = (envState?.runs || [])
    .filter((r) => (record.verifyRunIds || []).includes(r.id) && r.finishedAt)
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))[0];
  if (verified) return verified.id;
  const r = record.result;
  /* Nothing kept: the best trial that wasn't rejected, else the best of all. */
  const byScore = [...(r?.trials || [])].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const best = byScore.find((t) => !rejectedFor(t)) || byScore[0] || null;
  const n = record.preferredTrial || r?.winner?.n || best?.n || null;
  return n ? `${record.id}-t${n}` : null;
};

/** Where to open an improvement — always its own page. */
export const improvementUrl = (envId, record) => improvementPath(envId, record?.id);
