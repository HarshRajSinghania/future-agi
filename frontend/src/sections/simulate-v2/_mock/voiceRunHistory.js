/*
  Customer Support Line's run history, for the Runs tab's trend.

  The demo environment had one finished run before the fault run, so the pass
  rate across runs was a line between two points. These are the runs the
  agent's versions would have had between them — v2 through v10, three weeks
  of them, a slow climb — started by the people who own the line. Added once
  to a stored copy; every run there is then numbered by when it happened, so
  the list, the chart and each run's own page agree.
*/

export const HISTORY_ENV = "env-voice-support";

/*
  [run id, hours before the fault run, agent version, who started it]

  A run's outcomes are drawn from its id, so these ids are the ones whose
  draws tell the story: v2 around 70%, v3 around 80%, v10 around 90%, each
  run after its version was minted. The fault run then lands at 65%.
*/
const HISTORY = [
  ["run-voice-h1-7", 20.5 * 24, "v2", "Priya S."],
  ["run-voice-h2-36", 19 * 24, "v2", "Marco D."],
  ["run-voice-h3-52", 17 * 24, "v2", "Priya S."],
  ["run-voice-h4-3", 15 * 24, "v2", "Ana K."],
  ["run-voice-h5-33", 12 * 24, "v3", "Priya S."],
  ["run-voice-h6-28", 9 * 24, "v3", "Marco D."],
  ["run-voice-h7-18", 5 * 24, "v3", "Ana K."],
  ["run-voice-h8-63", 23, "v10", "Priya S."],
  ["run-voice-h9-24", 17, "v10", "Marco D."],
  ["run-voice-h10-4", 11, "v10", "Priya S."],
];
/* Bumped when the history changes; an older one is swapped out. */
const HISTORY_REV = 2;
const HOUR = 3600000;
const MIN = 60000;

const whenOf = (r) => Date.parse(r.finishedAt || r.startedAt || 0) || 0;

/** The environment's state with its history added and every run renumbered by time. */
export const withVoiceRunHistory = (env, es) => {
  const runs = es?.runs || [];
  if (!runs.length || runs.some((r) => r.seededAs === "history" && r.historyRev === HISTORY_REV)) return es;
  /* An earlier history goes; everything else stays. */
  const kept = runs.filter((r) => r.seededAs !== "history");
  const anchor = kept.find((r) => r.seededAs === "fault-demo") || [...kept].sort((a, b) => whenOf(b) - whenOf(a))[0];
  const base = kept.find((r) => r.id === "run-voice-1") || anchor;
  const scenarioIds = base?.scenarioIds?.length
    ? base.scenarioIds
    : (es.scenarios || []).filter((sc) => !sc.retired && !sc.archived).map((sc) => sc.id);
  const known = new Set((es.agentVersions || []).map((v) => v.label));
  const end = whenOf(anchor) || Date.now();

  const history = HISTORY
    .filter(([, , version]) => !known.size || known.has(version))
    .map(([id, hoursBack, version, who], i) => {
      const finishedAt = end - hoursBack * HOUR;
      const took = (9 + (i % 4) * 2) * MIN;
      return {
        id,
        seededAs: "history",
        historyRev: HISTORY_REV,
        label: "All scenarios",
        startedAt: new Date(finishedAt - took).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        total: scenarioIds.length,
        agentVersion: version,
        envVersion: anchor?.envVersion || "v1",
        seed: id,
        repeats: 3,
        scenarioIds,
        startedBy: who,
      };
    });

  const all = [...kept, ...history].sort((a, b) => whenOf(a) - whenOf(b));
  const renumbered = all.map((r, i) => ({ ...r, ordinal: i + 1 }));
  /* Stored newest first, as runs are recorded. */
  return { ...es, runs: renumbered.reverse() };
};
