/**
 * "Future AGI · verify" — the check we post on an improvement's PR.
 *
 * The PR carries the proof made when it was opened, on one commit. Review
 * goes on after that: someone pushes a typo fix, a rebase, a "small tweak".
 * So every push re-runs the improvement's frozen scenarios — visible,
 * held-back and must-pass, the same repeats — against the PR's exact head
 * commit and compares with that proof. It is evidence for the reviewer and
 * never blocks the merge — the harness doesn't gate a release.
 *
 * Status is derived from when a run was queued, so a reload mid-run still
 * lands on the right state:
 *   queued (1s) → running (until 4s) → passed | failed
 *
 * The prototype decides the result when the push arrives, deterministically
 * by push number, so the demo always tells the same story:
 *   push 0  the commit the proof was made on        → passes
 *   push 1  a follow-up that doesn't change behaviour → passes
 *   push 2  a "small tweak" that breaks a must-pass  → fails
 *   push 3+ the fix for that                         → passes
 */
import { useEffect, useState } from "react";
import { pushToPr, setPrCheck } from "./integrations";
import { hashSeed } from "./runStream";
import { REPEATS } from "./optimizationRuns";

export const CHECK_NAME = "Future AGI · verify";
const QUEUED_MS = 1000;
const RUNNING_MS = 4000;
const FAILING_PUSH = 2;
const REGRESSED = "Never confirm identity from the phone number alone";
const FALLBACK_SCENARIOS = 41;

/* Hashed twice — FNV alone gives near-identical prefixes for "push:1", "push:2". */
const sha = (s) => hashSeed(`${hashSeed(s)}:${s}`).toString(16).padStart(8, "0").slice(0, 7);

/** Only PRs that carry a proof have something to verify against; tracing PRs don't change behaviour. */
export const hasVerifyCheck = (pr) => !!pr && pr.kind !== "telemetry" && !!(pr.handoffKey || pr.meta?.handoffKey);

/* The commit the proof was made on — a coding agent's proof names it. */
const proofCommitOf = (pr) => pr.proofCommit || String(pr.body || "").match(/commit `([0-9a-f]{7,})`/)?.[1] || sha(`${pr.id}:proof`);

/* What the check re-runs: every frozen scenario the proof was measured on. */
const scopeOf = (pr) => {
  const body = String(pr.body || "");
  const n = (re) => Number(body.match(re)?.[1] || 0);
  const parsed = n(/of (\d+) visible scenarios/) + n(/must-pass \d+ of (\d+)/) + n(/on (\d+) scenarios/);
  return { scenarios: pr.check?.scenarios || parsed || FALLBACK_SCENARIOS, repeats: REPEATS };
};

const runFor = (pr, push, at) => {
  const head = push === 0 ? proofCommitOf(pr) : sha(`${pr.id}:push:${push}`);
  const failed = push === FAILING_PUSH;
  return {
    id: `${pr.id}-check-${push}`,
    sha: head,
    push,
    queuedAt: at,
    ...scopeOf(pr),
    result: failed ? "failed" : "passed",
    failure: failed ? { mustPass: REGRESSED } : null,
  };
};

/** The PR's check history, oldest first. PRs opened before checks existed get their first run at open. */
export const checksOf = (pr) => {
  if (!hasVerifyCheck(pr)) return [];
  return pr.checks?.length ? pr.checks : [runFor(pr, 0, pr.openedAt)];
};
export const headOf = (pr) => pr.head || checksOf(pr).at(-1)?.sha || null;

/** queued | running | passed | failed, at `now`. */
export const statusOf = (run, now = Date.now()) => {
  if (!run) return null;
  const t = now - Date.parse(run.queuedAt);
  if (t < QUEUED_MS) return "queued";
  if (t < RUNNING_MS) return "running";
  return run.result;
};
export const latestCheck = (pr) => checksOf(pr).at(-1) || null;
export const isPending = (s) => s === "queued" || s === "running";

/** Where the latest run on the head stands — said next to Merge, never blocking it. */
export const checkStandingOf = (pr, now = Date.now()) => {
  const s = statusOf(latestCheck(pr), now);
  if (s === "failed") return "failed";
  if (isPending(s)) return "pending";
  return null;
};

/** One line on what the run found. */
export const resultLine = (run, status) => {
  if (status === "queued") return "Queued";
  if (status === "running") return "Re-running the frozen scenarios…";
  if (status === "failed") return `Failed: must-pass “${run.failure?.mustPass}” regressed on ${run.sha}`;
  return run.push === 0 ? "Passed — matches the proof" : "Passed — still matches the proof";
};

/** Prototype: a commit lands on the PR's branch, and the check re-runs on it. */
export const simulatePush = (pr) => {
  const prev = checksOf(pr);
  const run = runFor(pr, prev.length, new Date().toISOString());
  pushToPr(pr.id, { head: run.sha, checks: [...prev, run] });
};

/** Re-run the latest check on the same commit — same sha, same result. */
export const rerunCheck = (pr) => {
  const run = latestCheck(pr);
  if (!run) return;
  if (!pr.checks?.length) pushToPr(pr.id, { head: run.sha, checks: [run] });
  setPrCheck(pr.id, run.id, { queuedAt: new Date().toISOString() });
};

/** Re-renders every second while `active`, so a derived status moves on. */
export const useNow = (active) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [active]);
  return now;
};
