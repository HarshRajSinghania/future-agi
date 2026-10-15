/* Clone-state evals are authored assertions — removed and re-authored, not
   opened. Everything else can show its mapping. */
export const canEditEval = (item) => !!item && item.evalKind !== "twin_end_state";
