/*
  The shareable report (PRD v6 · AC-20.9, Story 20 delivery).

  A read-only link to a finished run's report. The token is stamped from the
  run's provenance — the run, and every version it held fixed (environment,
  agent, suite, sub-goal catalogue, evals, simulated caller) — so a link always
  names exactly what it shows, and a link minted for one run never opens
  another.
*/
import { paths } from "src/routes/paths";
import { hashSeed } from "./runStream";
import { runPinsOf } from "./envModel";

const stampOf = (run, env, envState) => {
  const p = runPinsOf(run, env, envState);
  return [env?.id, run?.id, p.env, p.agent, p.suite, p.catalog, p.eval, p.simulator].join("|");
};

/** `shr_` + a short provenance fingerprint. Deterministic for the same run and pins. */
export const shareTokenOf = (run, env, envState) => {
  const s = stampOf(run, env, envState);
  return `shr_${hashSeed(s).toString(36)}${hashSeed(`${s}#`).toString(36).slice(0, 4)}`;
};

export const isShareTokenFor = (token, run, env, envState) => !!token && token === shareTokenOf(run, env, envState);

/** The read-only link — the run's own address with `?shared=`. */
export const sharedPathOf = (envId, runId, token, extra = {}) => {
  const q = new URLSearchParams({ shared: token, ...extra });
  return `${paths.dashboard.simulate.simulationRun(envId, runId)}?${q.toString()}`;
};

export const sharedUrlOf = (envId, runId, token, extra) => {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}${sharedPathOf(envId, runId, token, extra)}`;
};
