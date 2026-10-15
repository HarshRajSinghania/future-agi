import { UNITS } from "./observePopulation";

// Hand-offs between Instant eval (a question answered for every row in a
// view) and Analyse (a report that finds the patterns). Small context rides in
// the URL; row ids, which can run to thousands, ride in session storage under
// a short key so links stay short and survive a reload of the target page.

const PREFIX = "observe-handoff:";
export const ANALYSE_NEW_PARAM = "new";
export const ANALYSE_SEED_PARAM = "seed";
export const ASK_PARAM = "ask";

const makeKey = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function stashHandoff(value) {
  const key = makeKey();
  try {
    globalThis.sessionStorage?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the target opens with the scope from the URL only.
  }
  return key;
}

export function readHandoff(key) {
  if (!key) return null;
  try {
    const raw = globalThis.sessionStorage?.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Open the "New report" flow in the Analyse tab.
 *
 * seed: {
 *   unit: "traces" | "sessions" | "users",
 *   filters?: backend filters of the source view,
 *   label?: human scope label ("Past 7 days · 2 filters"),
 *   population?: [{id, time, user_id}]  // exact rows, e.g. every "No" answer
 *   question?: string                    // a starting question for the report
 *   source?: string                      // "Instant eval: <question>"
 * }
 */
export function analyseReportLink(projectId, seed) {
  const params = new URLSearchParams({ [ANALYSE_NEW_PARAM]: "1" });
  params.set(ANALYSE_SEED_PARAM, stashHandoff(seed));
  return `/dashboard/observe/${projectId}/analyse?${params.toString()}`;
}

/**
 * Open a view (Traces, Sessions or Users) with the Instant eval drawer open.
 *
 * ask: {
 *   unit: "traces" | "sessions" | "users",
 *   questions?: [{question, answerType: "yes_no" | "category", categories?, definitions?}],
 *   ids?: string[],   // only these rows
 *   label?: string,
 * }
 */
export function askLink(projectId, ask) {
  const unit = UNITS[ask?.unit] || UNITS.traces;
  const params = new URLSearchParams({ [ASK_PARAM]: stashHandoff(ask) });
  return `/dashboard/observe/${projectId}/${unit.tab}?${params.toString()}`;
}
