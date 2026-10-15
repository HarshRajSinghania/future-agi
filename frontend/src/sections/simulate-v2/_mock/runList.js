/**
 * What the Runs list contains — shared so every count of it agrees.
 *
 * The list is the runs someone started, plus one queued demo row. An
 * improvement's runs are hidden until "Show candidate runs", so the badge
 * counts what the list shows by default — the same number as Overview's Runs.
 */
import { runSummaries } from "./comparison";

/* Show at most this many trials, so the merged list stays readable. */
export const TRIAL_CAP = 8;

/* Prototype: one queued run on top of the table so the status is demoable.
   Off — a run that never starts read as a stuck real one. */
export const DEMO_QUEUED_ROW = false;

/** How many rows the Runs list shows — the same rows, the same rules. */
export function runListCount(env, envState) {
  if (!env || !envState) return 0;
  const finished = runSummaries(env, envState).filter((r) => !r.synthetic).length;
  const queued = DEMO_QUEUED_ROW && !envState.demoQueuedRemoved && finished > 0 ? 1 : 0;
  return finished + queued;
}
