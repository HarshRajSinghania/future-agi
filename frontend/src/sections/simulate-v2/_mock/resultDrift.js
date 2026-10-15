/**
 * Results that moved with nothing on our side changed.
 *
 * Two consecutive runs that pinned the same agent, environment, suite,
 * sub-goals, evals and simulated caller — over the same scenarios — should
 * score about the same. When they don't, the cause is outside everything we
 * version: for a connect-only agent that is usually the live account it books
 * under, whose credentials are agent configuration supplied per run (S8). So
 * the drop is named as that before anyone reads it as a regression.
 *
 * Pass rates come from runResultOf, the same reading every run summary uses.
 */
import { runPinsOf } from "./envModel";
import { runResultOf } from "./runResult";

const THRESHOLD = 10;

const samePins = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);
const sameScenarios = (a, b) => {
  if (!a.scenarioIds || !b.scenarioIds) return true;
  if (a.scenarioIds.length !== b.scenarioIds.length) return false;
  const ids = new Set(a.scenarioIds);
  return b.scenarioIds.every((id) => ids.has(id));
};

/**
 * Whether the two latest runs moved that way — `{ from, to, points, direction,
 * note }`, or null. Only the latest pair: an older move that a later run has
 * since explained is history, not a warning.
 */
export const unexplainedMoveOf = (env, envState, { threshold = THRESHOLD } = {}) => {
  const runs = (envState?.runs || [])
    .filter((r) => r.finishedAt && r.kind !== "trial")
    .sort((a, b) => new Date(a.finishedAt) - new Date(b.finishedAt));
  if (runs.length < 2) return null;
  const [a, b] = runs.slice(-2);
  if (!samePins(runPinsOf(a, env, envState), runPinsOf(b, env, envState)) || !sameScenarios(a, b)) return null;
  const ra = runResultOf(env, envState, a)?.rate;
  const rb = runResultOf(env, envState, b)?.rate;
  if (ra == null || rb == null) return null;
  const points = Math.abs(rb - ra);
  if (points <= threshold) return null;
  return {
    from: a,
    to: b,
    points,
    direction: rb < ra ? "down" : "up",
    note: `Pass rate moved ${points} pts with nothing on our side changed — check the caller account in your system before reading it as a regression.`,
  };
};
