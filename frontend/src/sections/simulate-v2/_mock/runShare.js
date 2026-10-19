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

/* Key order never changes the stamp. */
const stable = (v) => {
  if (v == null) return "";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${k}:${stable(v[k])}`).join(",")}}`;
  return String(v);
};

/*
  Only what the run stored about itself — never the environment as it stands
  now and never display text. Runs that didn't pin a version (seeded history)
  used to fall back to the current suite / sub-goal / eval version, so
  archiving a scenario or editing an eval broke every link already shared.
  The stored record is read from envState.runs, not the summary row (whose
  agent version can be a positional fallback).
*/
const stampOf = (run, env, envState) => {
  const r = (envState?.runs || []).find((x) => x.id === run?.id) || run || {};
  const evals = (r.evals || []).map((e) => (typeof e === "string" ? e : `${e?.id || ""}@${e?.version ?? ""}`));
  return [
    env?.id, r.id, r.agentVersion, r.envVersion, r.envSnapshot,
    r.suiteVersion, r.catalogVersion, r.evalVersion, r.simulator?.label,
    (r.scenarioIds || []).join(","), stable(r.scenarioVersions), evals.join(","), stable(r.secrets),
  ].map((x) => x ?? "").join("|");
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
