import { useMemo } from "react";
import { resolveEval, evalSlotsLeft, TOOL_CALL_JUDGE_ID } from "../../_mock/evals";

/**
 * Applied evals — shared between the Evals step and the Overview card.
 *
 * Both surfaces add, list and remove the same evals, so the reading, the
 * add/remove rules and the row markup live here once. Without this the two
 * would drift the moment either changed.
 */
export function useAppliedEvals(envState, patch) {
  const applied = envState.evals;

  const appliedEvals = useMemo(
    () => applied.map(resolveEval).filter(Boolean),
    [applied],
  );

  const appliedIds = useMemo(
    () => new Set(appliedEvals.map((e) => e.id)),
    [appliedEvals],
  );

  /* Evaluations keep their own version: an edit moves the evals (e1 → e2),
     never the environment's. Noted once a run has been graded — before that
     there is nothing graded differently to tell apart. */
  const nameOf = (id) => appliedEvals.find((e) => e.id === id)?.name || id;
  const changed = (detail) => ((envState.runs || []).length
    ? { evalChanges: [...(envState.evalChanges || []), { detail, at: new Date().toISOString() }] }
    : {});

  /* Up to 8 catalogue evaluations plus the tool-call judge — anything past
     the cap is left out, and the caller is told how many. */
  const slotsLeft = evalSlotsLeft(applied);
  const add = (entries) => {
    const unique = entries.filter((e) => !appliedIds.has(e.id));
    let room = slotsLeft;
    const fresh = unique.filter((e) => {
      if (e.id === TOOL_CALL_JUDGE_ID) return true;
      if (room <= 0) return false;
      room -= 1;
      return true;
    });
    if (fresh.length) {
      patch({
        evals: [...applied, ...fresh],
        ...changed(`Added ${fresh.map((e) => e.name || e.id).join(", ")}`),
      });
    }
    return { added: fresh.length, dropped: unique.length - fresh.length };
  };

  const remove = (id) =>
    patch({
      evals: applied.filter((e) => (typeof e === "string" ? e : e.id) !== id),
      ...changed(`Removed ${nameOf(id)}`),
    });

  /* Edit in place — keeps the eval's slot in the list. Bare-id records are
     promoted to objects so the edited mapping / threshold survive. */
  const update = (id, changes) =>
    patch({
      evals: applied.map((e) => {
        const entryId = typeof e === "string" ? e : e.id;
        if (entryId !== id) return e;
        return { ...(typeof e === "string" ? { id: e } : e), ...changes };
      }),
      ...changed(`Edited ${nameOf(id)}`),
    });

  /**
   * The picker returns a configured eval — template, judge model and the
   * variable→column mapping. Only what this prototype needs is kept, in the
   * same shape as a catalogue eval so both render through one row.
   */
  const onEvalAdded = (config) => {
    const id = config.templateId || config.id || `eval-${config.name}`;
    const mapping = config.mapping || {};
    /* Mapping is rendered as chips on the row now — don't duplicate it in
       the blurb. Blurb stays for the qualitative description. */
    add([{
      id,
      name: config.name || config.evalTemplate?.name || "Eval",
      blurb: config.evalTemplate?.description || "Added from the eval library",
      mapping,
      model: config.model,
      custom: true,
    }]);
  };

  /* Required — a failing score fails the conversation. Stored on the
     applied eval itself (`required: true`), so a run reads it from envState.evals. */
  const setRequired = (id, on) => update(id, { required: !!on });

  return { applied, appliedEvals, appliedIds, add, remove, update, onEvalAdded, setRequired, slotsLeft };
}
