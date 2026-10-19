/**
 * Release blockers.
 *
 * A scenario is a release blocker when failing it should stop a version
 * shipping no matter how good the pass rate looks. The flag is set when the
 * scenario is written — rule probes, adversarial pressure, forced safety tests
 * and some data traps — but it is the team's call, not ours, so it can be
 * turned on or off per row.
 *
 * An override remembers what the scenario was written as (`criticalWas`), so
 * turning it back restores the original rather than leaving a stale "you
 * changed this" behind, and the reason can still say why it was marked.
 */

const quotedRule = (row) => (row.expected || row.outcome || "").match(/rule: "(.+?)"/)?.[1];

/** Why the scenario was written as a release blocker — ignores any override. */
export function writtenReason(row) {
  const category = row?.branchCategory || "";
  if (row?.regressionMemory) {
    const m = row.regressionMemory;
    return `Regression memory — kept from the fix for ${m.issueId}, released as ${m.version}. If it fails again, the issue is back.`;
  }
  if (row?.productionCluster) {
    const c = row.productionCluster;
    return `Reproduces a critical production failure — ${(c.kindLabel || "failure").toLowerCase()}, seen ${c.count} time${c.count === 1 ? "" : "s"}.`;
  }
  if (category.startsWith("Rule Enforcement")) {
    const rule = quotedRule(row);
    return rule
      ? `Tests a rule the environment enforces: “${rule.replace(/\.$/, "")}”.`
      : "Tests a rule the environment enforces.";
  }
  if (category.startsWith("Adversarial")) {
    return `Adversarial — ${(row.title || "pressure").toLowerCase()}. Giving in here is a safety failure, not a quality one.`;
  }
  if (category.startsWith("Data Trap")) {
    const table = (row.title || "").split(":")[0];
    return `Data trap${table ? ` in ${table}` : ""} — treating the awkward record as ordinary changes real data.`;
  }
  if (/forced-overlay/.test(row?.name || "") || /safety test$/.test(row?.title || "")) {
    return `Safety test — ${(row.title || "").replace(/ — safety test$/, "").toLowerCase()}. Always included, and has to pass.`;
  }
  if (row?.origin) return `A step the ${row.origin} script says can't be skipped.`;
  return "Marked must-pass when it was written.";
}

/** The sentence the red triangle shows on hover. */
export function blockerReason(row) {
  if (!row?.critical) return null;
  return row.criticalBy === "you" ? "You marked this must-pass." : writtenReason(row);
}

/** Shown on the hollow triangle of a scenario someone un-marked. */
export function unmarkedNote(row) {
  if (row?.critical || row?.criticalBy !== "you" || !row?.criticalWas) return null;
  return `Was must-pass — ${writtenReason(row).replace(/^./, (c) => c.toLowerCase())} You un-marked it.`;
}

/**
 * Turn the flag on or off. Changing it back to what the scenario was written
 * as drops the override altogether.
 */
export function setBlocker(row, on) {
  const original = row.criticalBy === "you" ? !!row.criticalWas : !!row.critical;
  const { criticalBy, criticalWas, ...rest } = row;
  if (on === original) return { ...rest, critical: on };
  return { ...rest, critical: on, criticalBy: "you", criticalWas: original };
}

/** Only the blocker flag differs — the task, setup and checks are untouched. */
export function onlyBlockerChanged(before, after) {
  const strip = ({ critical, criticalBy, criticalWas, ...rest }) => rest;
  return JSON.stringify(strip(before || {})) === JSON.stringify(strip(after || {}));
}
