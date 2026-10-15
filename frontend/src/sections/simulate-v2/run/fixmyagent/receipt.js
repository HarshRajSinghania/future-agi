/*
  The receipt — every check an improvement made, in order, each entry
  hashed with the one before it so none can be changed or dropped after the
  fact. Written by the gate that refuses to let the proposer grade itself.
*/
import { hashSeed } from "../../_mock/runStream";
import { judgeFor, REPEATS } from "../../_mock/optimizationRuns";
import { TIERS } from "../../_mock/improverAttempts";
import { proofDisplay } from "./proofBlock";

const hex = (s) => hashSeed(s).toString(16).padStart(8, "0") + hashSeed(`${s}~`).toString(16).padStart(8, "0");

const mark = (pass) => (pass === null ? "unverified" : pass ? "passed" : "failed");

export const receiptOf = (record, outcome, { attempts = [], identity = null, envSnapshot = null } = {}) => {
  const r = record?.result;
  if (!r) return [];
  /* A record stamped with the newer engine writes each constraint check as
     its own entry, the calibration, and every improver attempt. */
  const stamped = !!record.frozen?.staticCheck;
  const proposer = record.model === "claude-opus-5" ? "Claude Opus 5" : record.model;
  const lines = [
    ...(record.reread ? [["Agent synced", record.reread.changed ? `Changed outside Future AGI → baseline on ${record.reread.version || "the new version"}` : "no outside change"]] : []),
    ["Inputs frozen", `${r.trainMeasured + r.heldMeasured} scenarios${identity ? ` on ${identity}` : envSnapshot ? ` on env ${envSnapshot}` : ""}, the must-pass list, the rules, the model lock and the cost ceiling`],
    ...(record.reproduce ? [["Failure reproduced", `${record.reproduce.reproduced} of ${record.reproduce.total} · ${record.reproduce.inconclusive || 0} inconclusive`]] : []),
    ...(record.proof ? [["Proof kind", record.proof.kind === "prompt-only" ? proofDisplay(record.proof).line : `${record.proof.label} · ${record.proof.tierLabel}${record.proof.kind === "live" ? " — tools reached your real systems" : ""}`]] : []),
    ...(r.split?.kind === "issue" ? [["Held back", r.split.thin ? "none — held-back check is thin" : `${r.split.held} of ${r.split.reproducing} reproducing groups + ${r.split.fresh} fresh variations`]] : []),
    ["Baseline measured", `${r.base}% on training, ${r.heldBase}% held back · noise ±${r.noise || 0}`],
    ...(stamped && r.calibration ? [["Calibration · baseline twice", `Ran ${r.calibration.version || record.baseAgentVersion || "the current version"} twice: ${r.calibration.disagreed} of ${r.calibration.scenarios} scenarios disagreed → a flip must show up on more than one repeat · noise ±${r.noise} pts`]] : []),
    ...(stamped && r.goal ? [["Targets", `${r.goalTargets} ${r.goalTargets === 1 ? "scenario falls" : "scenarios fall"} short of ${r.goal.id === "pass-rate" ? "the pass rate" : r.goal.label}${r.split?.kind === "goal" ? ` · ${r.split.thin ? "none held back — thin" : `${r.split.held} of ${r.split.reproducing} failing groups held back + ${r.split.fresh} fresh variations`}` : ""}`]] : []),
    ["Runs proposed", `${r.trials.length} by ${proposer}${r.stoppedEarly ? ` · stopped after ${r.stoppedEarly.after} with no gain` : ""}`],
    ["Runs judged", `by ${judgeFor(record.model)} — a different model family`],
    stamped
      ? ["Static checks", `model, protected parts, areas, settings in range, judges untouched${r.repoTests ? `, ${r.repoTests} on code changes` : ""} — every run · ${(() => { const n = r.trials.filter((t) => t.static && t.static.pass === false).length; return n ? `${n} stopped there` : "all passed"; })()}`]
      : ["Static checks", `model, protected parts, judges untouched${r.repoTests ? `, ${r.repoTests} on code changes` : ""} — every run`],
    /* Only improvements stamped with the check (record.frozen.compatCheck) carry it. */
    ...(r.compat ? [["Fits the environment", `entry point ${r.compat.entry}, build and start command checked against the sealed environment${envSnapshot ? ` env ${envSnapshot}` : r.compat.envVersion ? ` ${r.compat.envVersion}` : ""} — every code change · ${(() => { const n = r.trials.filter((t) => t.compat && t.compat.pass === false).length; return n ? `${n} didn't fit, stopped there` : "all fit"; })()}`]] : []),
    ...(r.textSearch ? [["Searched in text", "runs as text conversations · finalists as real calls"]] : []),
    ...(r.scope?.canaries || r.scope?.offLimits ? [["Cheat checks", `${[r.scope.canaries ? `${r.scope.canaries} ${r.scope.canaries === 1 ? "canary" : "canaries"}` : null, r.scope.offLimits ? `${r.scope.offLimits} off-limits ${r.scope.offLimits === 1 ? "tool" : "tools"}` : null].filter(Boolean).join(" · ")} — every run · ${r.trials.filter((t) => t.cheats).length + (r.heldCheats?.length ? 1 : 0)} caught`]] : []),
    ...(r.winner ? [
      ["Finalists scored once", (r.finalists || []).length ? r.finalists.map((f) => `Run ${f.n} ${f.heldScore}%${f.winner ? " · winner" : ""}`).join(" · ") : `${r.heldBase}% → ${r.heldScore}%`],
      ["Held-back set", `${r.heldBase}% → ${r.heldScore}% on ${r.heldMeasured} scenarios`],
      ["Must-pass set", `${r.mustPass?.total ?? "—"} scenarios · ${(r.heldBlockers || []).length ? `${r.heldBlockers.length} failed again on a re-run` : "none failed twice"}${(r.flakyToday || []).length ? ` · ${r.flakyToday.length} flaky, not counted` : ""}`],
      ["Repeats", stamped && (r.finalists || []).find((f) => f.winner)?.fullRegression
        ? `each scenario ${r.repeats || REPEATS}× · code change → ${(r.finalists || []).find((f) => f.winner).repeats} repeats per finalist and the full regression set`
        : `each scenario ${r.repeats || REPEATS}×`],
    ] : []),
    /* Each constraint the winner was held to, on its own line. */
    ...(stamped ? (outcome?.checks || []).filter((c) => c.id !== "static").map((c) => [`Constraint · ${c.label}`, `${c.actual} — ${mark(c.pass)}`]) : []),
    /* The customer's coding agent: every attempt and the verdict it was sent. */
    ...attempts.flatMap((a) => [
      [`Improver attempt · ${a.label}`, `${a.title} · commit ${a.commit}${a.fingerprint ? ` + ${a.fingerprint}` : ""} · ${a.gate ? "not run" : TIERS[a.where]?.label || a.where}`],
      [`Verdict · attempt ${a.n}`, a.accepted ? "accepted — proven by Future AGI" : `rejected — ${String(a.why || "a check failed").replace(/\.$/, "")}${a.gate ? " · not charged" : ""}`],
    ]),
    ["Verdict", `${outcome?.ending?.label || "—"}`],
  ];
  let prev = hex(`${record.id}:genesis`);
  return lines.map(([step, detail], i) => {
    const hash = hex(`${prev}:${i}:${step}:${detail}`);
    const entry = { n: i + 1, step, detail, prev, hash };
    prev = hash;
    return entry;
  });
};
