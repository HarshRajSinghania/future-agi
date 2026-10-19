/**
 * Failing cases — the scenarios that failed, or came out flaky, in this
 * environment's own runs, turned into scenarios that reproduce the failure.
 *
 * A run already says which scenarios failed and on which grader. Adding one
 * back as a variation keeps that failure in the suite on purpose: the caller
 * takes the conversation to the turn where it went wrong and holds it there,
 * so a later agent version has to get past exactly that point.
 *
 * Read off the same rebuilt runs every other screen reads (runSummaries), so
 * the verdicts here are the ones the run page shows.
 */
import { runSummaries } from "./comparison";

const FAILING = new Set(["failed", "flaky"]);

/** The scenario a failing case adds — one per run and task. */
export const failingCaseScenarioId = (kase) => `from-run::${kase.runId}::${kase.taskId}`;

/**
 * Every failed or flaky task across this environment's finished runs, newest
 * run first. Each carries its run, its verdict, the grader that failed it and
 * the line where it went wrong.
 */
export const failingCasesOf = (env, envState) => {
  if (!env) return [];
  const byId = new Map((envState?.scenarios || []).map((sc) => [sc.id, sc]));
  return runSummaries(env, envState)
    .filter((run) => !run.synthetic)
    .reverse()
    .flatMap((run) => run.tasks
      .filter((t) => FAILING.has(t.status))
      .map((t) => {
        const culprit = (t.evalResults || []).find((e) => !e.passed) || null;
        const step = t.failStep != null ? t.steps?.[t.failStep] : null;
        return {
          key: `${run.id}::${t.id}`,
          runId: run.id,
          runOrdinal: run.ordinal,
          runLabel: run.label || null,
          agentVersion: run.agentVersion,
          finishedAt: run.finishedAt || null,
          taskId: t.id,
          name: t.title || t.name || t.id,
          title: t.title || t.name,
          summary: t.summary,
          verdict: t.status,
          passes: t.passes,
          repeats: t.repeats,
          critical: !!t.critical,
          evalName: culprit?.name || null,
          reason: culprit?.reason || null,
          quote: step?.text || null,
          turn: t.failStep != null ? t.failStep + 1 : null,
          scenario: byId.get(t.id) || null,
        };
      }));
};

/**
 * The scenario a failing case becomes: the same task, caller and pass
 * condition as the one that failed, pressed at the turn where it failed.
 * It links back to the run and task it came from.
 */
export const scenarioFromFailingCase = (kase, env) => {
  const sc = kase.scenario || {};
  const n = kase.runOrdinal;
  const how = kase.verdict === "flaky"
    ? `came out flaky (${kase.passes} of ${kase.repeats} passed)`
    : "failed";
  const where = kase.turn ? ` at turn ${kase.turn}` : "";
  return {
    id: failingCaseScenarioId(kase),
    name: `${sc.name || kase.name}-repro-r${n}`,
    title: `${sc.title || kase.title} — as it failed in run ${n}`,
    summary: `Reproduces run ${n}: ${kase.evalName ? `${kase.evalName.toLowerCase()} ` : ""}${how}${where}`,
    useCase: sc.useCase,
    task: sc.task || kase.summary,
    situation: [
      (sc.situation || sc.task || "").trim().replace(/\.?$/, "."),
      `The caller steers back to where run ${n} went wrong${kase.quote ? ` — “${kase.quote}”` : ""} — and holds it there.`,
    ].filter((part) => part && part !== ".").join(" "),
    persona: sc.persona,
    subTasks: sc.subTasks,
    actors: sc.actors,
    expected: sc.expected,
    outcome: sc.outcome,
    turns: sc.turns,
    critical: !!sc.critical,
    branchCategory: sc.branchCategory,
    batchNote: `from run ${n}`,
    failingCase: {
      envId: env?.id,
      runId: kase.runId,
      runOrdinal: n,
      taskId: kase.taskId,
      taskName: kase.name,
      verdict: kase.verdict,
      passes: kase.passes,
      repeats: kase.repeats,
      agentVersion: kase.agentVersion,
      evalName: kase.evalName,
    },
  };
};
