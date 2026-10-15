/*
  The eval picker lists the real library, whose rows say `eval_type`
  ("llm" · "agent" · "code") rather than the catalogue's `type`. This reads
  either into the shape metering's `evalRailOf` takes, so a ticked library
  eval shows the same rail it will carry once added.
*/
export const railInputOf = (item) => {
  if (!item) return {};
  if (item.type || item.byok) return item;
  const kind = String(item.eval_type || item.evalType || "").toLowerCase();
  if (kind === "code" || kind === "deterministic" || kind === "rule") return { ...item, type: "Deterministic" };
  /* An LLM or agent judge — and the library's default when it doesn't say. */
  return { ...item, type: "LLM judge" };
};
