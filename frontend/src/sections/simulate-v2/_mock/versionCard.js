/*
  One card per new agent version — what reaches an environment when its agent
  changes. The per-change nudges (decoupled.js / nudgeEffects.js) are still
  detected and stored as they were; this module reads them as one card and
  applies them together.

    capabilities  add / behaviour — the world must answer what the agent
                  calls, so these are mechanical: one Rebuild applies them all
                  as one new environment version, no per-item review.
    rules         a changed rule a sub-goal tests — never applied for you. Each
                  needs an answer (Policy change / Not intended),
                  because auto-updating the test to fit the agent would hide
                  the very regression testing exists to catch.
    scenarios     the second step, after the environment moved: scenarios for
                  new tools, and N/A for scenarios that need a removed one.

  A newer version replaces an open older card: every open change is between
  the environment and the agent, so the card shows them all under the newest
  version. Skip is never final — the card collapses to "Skipped" with Rebuild
  anyway, and a newer version folds skipped changes back in (withNudges).

  State this module adds to envState (all optional):
    nudges[].skippedAs        the agent version the card was skipped at
    scenarioUpdate            { status: open | done | skipped, envVersion, adds: [{ tool, nudgeId }], at }
*/
import { resolveNudgePatch } from "./decoupled";
import { addScenarioRows, approveRemovePatch, generationPrice, plural, storedEnvList } from "./nudgeEffects";
import { agentVersions, nextEnvVersion, pendingEnvChanges, versionNumber } from "./versions";
import { agentToolsFor, worldToolsFor } from "./toolFit";
import { stampNewBatch } from "./addScenarios";
import { suiteLogPatch } from "./suiteLog";

const nowIso = () => new Date().toISOString();
const CAPABILITY = new Set(["add", "behaviour"]);
const byNumber = (a, b) => versionNumber(a) - versionNumber(b);

/** The environment's one card for its agent's changes, or null when there is nothing to say. */
export const versionCardOf = (envState) => {
  const all = envState?.nudges || [];
  const open = all.filter((n) => n.status === "open");
  const skipped = all.filter((n) => n.status === "dismissed" && n.skippedAs);
  /* Removals alone are the scenario step's (scenarioStepOf) — nothing in the
     world changes for them, so they don't hold the card open. */
  if (!open.some((n) => n.kind !== "remove") && !skipped.length) return null;
  const items = open.length ? open : skipped;
  const versions = [...new Set(items.map((n) => n.agentVersion).filter(Boolean))].sort(byNumber);
  const newest = versions[versions.length - 1] || null;
  const from = items.map((n) => n.prevVersion).filter(Boolean).sort(byNumber)[0] || null;
  /* What changed in the agent, from the versions themselves. */
  const known = agentVersions(envState);
  const changes = versions.flatMap((label) => (known.find((v) => v.label === label)?.changes || []).map((c) => ({ ...c, version: label })));
  return {
    status: open.length ? "open" : "skipped",
    newest,
    from,
    versions,
    changes,
    capabilities: items.filter((n) => CAPABILITY.has(n.kind)),
    rules: items.filter((n) => n.kind === "rule"),
    removals: items.filter((n) => n.kind === "remove"),
    other: items.filter((n) => !CAPABILITY.has(n.kind) && n.kind !== "rule" && n.kind !== "remove"),
  };
};

/* The tool an Add brings, as the agent version describes it. */
const toolOf = (env, envState, nudge) => agentToolsFor(env, envState, nudge.agentVersion).find((t) => t.name === nudge.capability)
  || { name: nudge.capability, desc: "", args: [] };

/**
 * Rebuild: every capability change on the card as one environment version —
 * handlers added, behaviour followed. Scenarios aren't touched here; the
 * scenario step comes next. Returns { patch, envLabel, summary }.
 */
export const rebuildEnvironmentPatch = (env, envState, card) => {
  const adds = card.capabilities.filter((n) => n.kind === "add");
  const behaviour = card.capabilities.filter((n) => n.kind === "behaviour");
  if (!adds.length && !behaviour.length) return null;
  const world = worldToolsFor(env, envState);
  const added = adds.map((n) => toolOf(env, envState, n));
  const names = new Set(added.map((t) => t.name));
  const summary = [
    adds.length && `added ${added.map((t) => t.name).join(", ")}`,
    behaviour.length && `updated ${behaviour.map((n) => n.capability).join(", ")}`,
  ].filter(Boolean).join("; ");
  /* One draft per environment: unsaved hand edits are saved with the rebuild
     (nextEnvVersion folds them in), so they never sit "since" a version
     they're already older than. */
  const waiting = pendingEnvChanges(envState);
  const minted = {
    ...nextEnvVersion(env, envState, {
      changed: [adds.length && "contract", behaviour.length && "toolbehaviour"].filter(Boolean),
      note: `Rebuilt for agent ${card.newest}: ${summary}.`,
    }),
    tools: [...world.filter((t) => !names.has(t.name)), ...added],
    fromNudges: card.capabilities.map((n) => n.id),
  };
  let nudgesState = envState;
  card.capabilities.forEach((n) => {
    nudgesState = { ...nudgesState, ...resolveNudgePatch(nudgesState, n.id, "approved", { envVersion: minted.label, rebuilt: true }) };
  });
  return {
    envLabel: minted.label,
    summary,
    alsoSaved: waiting.length,
    patch: {
      envVersions: [...storedEnvList(env, envState), minted],
      activeEnvVersion: minted.label,
      unsavedEnvChanges: [],
      nudges: nudgesState.nudges,
      /* New tools get scenarios in the next step — said, never started. */
      /* Merged with any step still waiting, so an earlier rebuild's new
         tools don't lose their scenarios to a later one. */
      ...(adds.length && {
        scenarioUpdate: {
          status: "open",
          envVersion: minted.label,
          adds: [
            ...(envState?.scenarioUpdate?.status !== "done" ? envState?.scenarioUpdate?.adds || [] : []).filter((a) => !adds.some((n) => n.capability === a.tool)),
            ...adds.map((n) => ({ tool: n.capability, nudgeId: n.id })),
          ],
          at: nowIso(),
        },
      }),
    },
  };
};

/** The scenario step: new tools to write scenarios for, and removed tools whose scenarios are stale. */
export const scenarioStepOf = (envState) => {
  const update = envState?.scenarioUpdate;
  const removals = (envState?.nudges || []).filter((n) => n.kind === "remove" && n.status === "open");
  const adds = update?.status === "open" ? update.adds || [] : [];
  if (!adds.length && !removals.length) {
    return update?.status === "skipped" ? { status: "skipped", adds: update.adds || [], removals: [] } : null;
  }
  const newRows = adds.length * 3;
  return {
    status: "open",
    adds,
    removals,
    newRows,
    staleRows: removals.reduce((a, n) => a + (n.scenarioIds || []).length, 0),
    price: newRows ? generationPrice(newRows) : null,
  };
};

/** Rebuild scenarios: three new scenarios per new tool; scenarios needing a removed one are stale. */
export const rebuildScenariosPatch = (env, envState, step) => {
  const at = nowIso();
  let working = envState;
  let patch = {};
  const merge = (p) => { patch = { ...patch, ...p }; working = { ...working, ...p }; };
  const added = [];
  step.adds.forEach(({ tool, nudgeId }) => {
    const nudge = (working.nudges || []).find((n) => n.id === nudgeId) || { id: nudgeId, capability: tool, agentVersion: null };
    const t = toolOf(env, working, nudge);
    const { rows } = stampNewBatch(addScenarioRows(env, t, nudge), { env, envState: working, source: "generated", actor: "nudge", at });
    added.push(...rows);
    merge({ scenarios: [...rows, ...(working.scenarios || [])] });
  });
  if (added.length) {
    merge(suiteLogPatch(working, {}, { summary: `${plural(added.length, "new scenario")} for ${step.adds.map((a) => a.tool).join(", ")}`, by: "nudge" }));
  }
  step.removals.forEach((n) => merge(approveRemovePatch(working, n)));
  merge({ scenarioUpdate: { ...(working.scenarioUpdate || {}), status: "done", doneAt: at } });
  return { patch, added: added.length, stale: step.staleRows };
};

/* Skip the scenario step — reopenable, like the card. Its removals are set
   aside as the step's (`scenarioSkipped`), not the card's: skipping scenarios
   doesn't make the whole agent change read "skipped". */
export const skipScenariosPatch = (envState) => ({
  scenarioUpdate: { ...(envState?.scenarioUpdate || {}), status: "skipped", skippedAt: nowIso() },
  nudges: (envState?.nudges || []).map((n) => (n.kind === "remove" && n.status === "open" ? { ...n, status: "dismissed", scenarioSkipped: n.agentVersion, resolvedAt: nowIso() } : n)),
});
export const reopenScenariosPatch = (envState) => ({
  scenarioUpdate: { ...(envState?.scenarioUpdate || {}), status: "open" },
  nudges: (envState?.nudges || []).map((n) => (n.kind === "remove" && n.status === "dismissed" && n.scenarioSkipped ? { ...n, status: "open", scenarioSkipped: undefined } : n)),
});

/** Skip the card: every open change set aside at this version — not final. */
export const skipCardPatch = (envState, card) => ({
  nudges: (envState?.nudges || []).map((n) => (n.status === "open"
    ? { ...n, status: "dismissed", skippedAs: card.newest, resolvedAt: nowIso() }
    : n)),
});

/** Bring a skipped card back. */
export const reopenCardPatch = (envState) => ({
  nudges: (envState?.nudges || []).map((n) => (n.status === "dismissed" && n.skippedAs
    ? { ...n, status: "open", skippedAs: undefined, reopenedAt: nowIso() }
    : n)),
});
