/*
  Workspace feature flags.

  `agentImprovement` — the Error Feed's Fix, the Improvements list and New
  improvement. Phase 1 ships it to design partners only, so it is a flag on
  the workspace (`state.flags.agentImprovement`), on in this prototype's
  seeded workspace and labelled "Design partner preview" wherever it shows.

  Read from the store's saved copy, so it works above every store provider
  too (the left nav) and stays a light import: switching it commits to the
  store (which saves synchronously) and announces the change. A demo can
  force it either way for the rest of the browser session with
  `?flag.agentImprovement=0` (or `=1`).
*/
import { useSyncExternalStore } from "react";

export const AGENT_IMPROVEMENT = "agentImprovement";
export const PREVIEW_LABEL = "Design partner preview";
export const PREVIEW_NOTE = "Agent improvement is in early access for design partners. Fixes and improvements end as drafts for you to review — nothing ships on its own.";

const DEFAULTS = { [AGENT_IMPROVEMENT]: true };
const EVENT = "fagi:flags";
const SESSION_KEY = (flag) => `fagi.flag.${flag}`;
/* The simulation store's saved copy — whichever version of its key is newest. */
const STORE_KEY = /^fagi\.simulate\.studio\.v(\d+)$/;

const safe = (fn, fallback = null) => {
  try { return fn(); } catch { return fallback; }
};

/* `?flag.agentImprovement=0` — remembered for the session so it survives navigation. */
const queryOverride = (flag) => {
  if (typeof window === "undefined") return null;
  const raw = safe(() => new URLSearchParams(window.location.search).get(`flag.${flag}`));
  if (raw === "0" || raw === "1") {
    safe(() => window.sessionStorage.setItem(SESSION_KEY(flag), raw));
    return raw === "1";
  }
  const kept = safe(() => window.sessionStorage.getItem(SESSION_KEY(flag)));
  return kept === "0" || kept === "1" ? kept === "1" : null;
};

const storedFlags = () => {
  if (typeof window === "undefined") return {};
  return safe(() => {
    const keys = Object.keys(window.localStorage).filter((k) => STORE_KEY.test(k));
    if (!keys.length) return {};
    const newest = keys.sort((a, b) => Number(b.match(STORE_KEY)[1]) - Number(a.match(STORE_KEY)[1]))[0];
    return JSON.parse(window.localStorage.getItem(newest) || "{}")?.flags || {};
  }, {});
};

/** Is the flag on — the query override, then the workspace's flags, then the default. */
export const flagOn = (flag, flags) => {
  const forced = queryOverride(flag);
  if (forced !== null) return forced;
  const value = (flags || {})[flag];
  return value === undefined ? !!DEFAULTS[flag] : !!value;
};

/** Tell readers outside the store (the nav) that a flag moved. */
export const announceFlags = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
};

/** Turning a flag on or off also clears a session override, so the switch is what counts. */
export const clearFlagOverride = (flag) => {
  safe(() => window.sessionStorage.removeItem(SESSION_KEY(flag)));
};

/* The saved copy is large; it's parsed once, then again only when a flag moves. */
let cachedFlags = null;
const savedFlags = () => {
  if (cachedFlags === null) cachedFlags = storedFlags();
  return cachedFlags;
};

const subscribe = (cb) => {
  if (typeof window === "undefined") return () => {};
  const on = () => { cachedFlags = null; cb(); };
  window.addEventListener(EVENT, on);
  window.addEventListener("storage", on);
  window.addEventListener("popstate", on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener("storage", on);
    window.removeEventListener("popstate", on);
  };
};

/** Whether agent improvement is on for this workspace (`state.flags.agentImprovement`). */
export function useAgentImprovementFlag() {
  return useSyncExternalStore(
    subscribe,
    () => flagOn(AGENT_IMPROVEMENT, savedFlags()),
    () => !!DEFAULTS[AGENT_IMPROVEMENT],
  );
}
