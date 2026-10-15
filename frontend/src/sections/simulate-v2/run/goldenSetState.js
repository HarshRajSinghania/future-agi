import { useCallback, useEffect, useState } from "react";
import { deriveGoalOutcome } from "./goalOutcome";

/*
  The golden set's storage and hook — kept out of goldenSet.jsx so that file
  only exports components (Fast Refresh). Stored in localStorage per env id.
*/

const KEY = (envId) => `simulate-v2:golden-set:${envId || "default"}`;

/* Storage returns null when the user has never touched the golden
   set for this env — that's the signal the hook uses to trigger
   auto-population on first mount. An explicit clear writes `{ ids:
   [] }` which is a *touched* empty state and will NOT auto-repopulate. */
function readGolden(envId) {
  try {
    const raw = window.localStorage.getItem(KEY(envId));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return { ids: Array.isArray(p?.ids) ? p.ids : [] };
  } catch { return null; }
}
function writeGolden(envId, state) {
  try { window.localStorage.setItem(KEY(envId), JSON.stringify(state)); } catch { /* noop */ }
}

export function useGoldenSet(env, tasks) {
  const envId = env?.id;
  const [state, setState] = useState(() => readGolden(envId) || { ids: [] });
  useEffect(() => { setState(readGolden(envId) || { ids: [] }); }, [envId]);

  /* Cross-tab / cross-widget sync: any widget that toggles the
     golden set fires a window CustomEvent so every mounted golden
     widget re-reads from storage without prop-threading. */
  useEffect(() => {
    const handler = (e) => { if (e.detail?.envId === envId) setState(readGolden(envId) || { ids: [] }); };
    window.addEventListener("golden-set:changed", handler);
    return () => window.removeEventListener("golden-set:changed", handler);
  }, [envId]);

  /* First-touch auto-population — if the user has never interacted
     with the golden set for this env, pick the top-N goal-achieved
     calls automatically so the divergence widgets render with
     real data on first load. Only fires once per env because we
     then write to storage (transitions "untouched" → "touched"). */
  useEffect(() => {
    if (!envId) return;
    if (readGolden(envId) !== null) return; // already touched
    const pool = (tasks || []).filter((t) => deriveGoalOutcome(t) === "achieved");
    if (pool.length === 0) return;
    const picks = [...pool]
      .sort((a, b) => (a.steps?.length || 99) - (b.steps?.length || 99))
      .slice(0, Math.min(10, pool.length))
      .map((t) => t.id);
    const next = { ids: picks };
    writeGolden(envId, next);
    setState(next);
    window.dispatchEvent(new CustomEvent("golden-set:changed", { detail: { envId } }));
  }, [envId, tasks]);

  const toggle = useCallback((taskId) => {
    setState((prev) => {
      const has = prev.ids.includes(taskId);
      const nextIds = has ? prev.ids.filter((x) => x !== taskId) : [...prev.ids, taskId];
      const next = { ids: nextIds };
      writeGolden(envId, next);
      window.dispatchEvent(new CustomEvent("golden-set:changed", { detail: { envId } }));
      return next;
    });
  }, [envId]);

  const markTopN = useCallback((tasks, n = 10) => {
    /* Auto-pick the N "best" calls — passing tasks with the goal
       outcome achieved, sorted by fewest turns (crisp, efficient
       calls make the strongest ground truth). */
    const candidates = (tasks || [])
      .filter((t) => deriveGoalOutcome(t) === "achieved")
      .sort((a, b) => (a.steps?.length || 99) - (b.steps?.length || 99))
      .slice(0, n)
      .map((t) => t.id);
    const next = { ids: candidates };
    writeGolden(envId, next);
    window.dispatchEvent(new CustomEvent("golden-set:changed", { detail: { envId } }));
    setState(next);
  }, [envId]);

  const clear = useCallback(() => {
    const next = { ids: [] };
    writeGolden(envId, next);
    window.dispatchEvent(new CustomEvent("golden-set:changed", { detail: { envId } }));
    setState(next);
  }, [envId]);

  return { ids: state.ids, toggle, markTopN, clear };
}
