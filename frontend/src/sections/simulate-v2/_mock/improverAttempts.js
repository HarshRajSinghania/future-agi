/*
  Bring your own improver — the customer's coding agent proposes, Future AGI
  judges.

  Each time the coding agent wants proof it submits a candidate. We run the
  baseline and the candidate on the same scenarios, check the constraints and
  return a verdict. The agent sees per-scenario results only for the visible
  scenarios, and only pass or fail for the must-pass set. It iterates within
  a budget of attempts, then opens a PR carrying our proof.

  Mocked as a session that submits every few seconds once it starts, so the
  loop can be watched: two rejected attempts and one accepted, unless the
  budget runs out first. Everything is derived from the improvement record and
  the attempt number, so a reload shows the same attempts.
*/
import { hashSeed } from "./runStream";
import { PER_CONVERSATION, REPEATS } from "./optimizationRuns";
import { codingAgentById, heldBackHiddenFrom } from "./integrations";

/* How many candidates one improvement accepts from an outside agent. */
export const ATTEMPT_BUDGET = 5;
/* Seconds between submissions in the prototype — a real agent takes minutes. */
const PACE = 8;

/*
  Where a candidate ran, and what we can stand behind for each — the trust
  tiers. Every proof names its tier.
*/
export const TIERS = {
  "future-agi": { label: "Run by Future AGI", note: "A pushed commit run in our sandbox — the full proof" },
  local: { label: "Run on your machine", note: "Your local code through our SDK, identified by commit and a fingerprint of uncommitted changes — our scenarios and scoring, the code identity is reported by your agent" },
  deployed: { label: "Deployed by you", note: "An endpoint or assistant we don't control — our scenarios and scoring, but we can't see what runs there" },
};

const sha = (s) => hashSeed(s).toString(16).padStart(8, "0").slice(0, 7);

/* What each attempt tried, and why the verdict went the way it did. */
const SCRIPT = [
  {
    title: "Rewrote the closing turn to read the tool result first",
    where: "local",
    dirty: true,
    reject: "mustPass",
    why: "A must-pass scenario regressed: the new closing turn skipped the identity check on a short call.",
  },
  {
    title: "Added a confirmation step and a second model call before closing",
    where: "local",
    dirty: false,
    reject: "cost",
    why: "Cost per conversation rose past the ceiling — the second model call runs on every turn.",
  },
  {
    title: "Gated the closing statement on the tool result, without the extra call",
    where: "future-agi",
    dirty: false,
    reject: null,
    why: null,
  },
];

/*
  A newer improvement's session (stamped `frozen.staticCheck`) also shows the
  gate at work: one attempt edits an evaluation file, and it is rejected
  before anything runs — never run, never charged.
*/
const SCRIPT_V2 = [
  SCRIPT[0],
  {
    title: "Loosened the Task success threshold and reworded the closing turn",
    where: "local",
    dirty: true,
    reject: "gate",
    files: ["evals/task_success.yaml", "prompts/system.md"],
    why: "Diff edits an evaluation file — rejected, not run, not charged.",
  },
  SCRIPT[1],
  SCRIPT[2],
];
/* The files an attempt's diff touches; the gate rejects any under scenarios/ or evals/. */
const JUDGE_PATH = /(^|\/)(scenarios|evals)\//;
export const gateOf = (files = []) => {
  const hit = files.find((f) => JUDGE_PATH.test(f));
  if (!hit) return null;
  return /(^|\/)evals\//.test(hit) ? `Diff edits an evaluation file (${hit}) — rejected, not run, not charged.` : `Diff edits a scenario file (${hit}) — rejected, not run, not charged.`;
};

/**
 * The attempts a session has submitted so far — the ones whose time has come.
 * Stops at the first accepted one, or at the attempt budget.
 */
export const attemptsOf = (record, session, { now = Date.now(), surface, budgetLeft = Infinity } = {}) => {
  const r = record?.result;
  if (!session || !r) return [];
  if (record.frozen?.staticCheck) return attemptsV2(record, session, { now, surface, budgetLeft });
  const started = Date.parse(session.startedAt);
  const agent = codingAgentById(session.agentId) || { label: "Your coding agent" };
  const visible = (r.trainMeasuredTasks || []).filter((t) => !t.critical);
  const mustPass = [...(r.trainMeasuredTasks || []), ...(r.heldTasks || [])].filter((t) => t.critical);
  const per = PER_CONVERSATION[surface === "voice" ? "voice" : "chat"];
  const ceiling = record.limits?.costCeiling ?? 5;

  const out = [];
  let spent = 0;
  for (let n = 1; n <= Math.min(ATTEMPT_BUDGET, SCRIPT.length); n += 1) {
    const at = started + n * PACE * 1000;
    if (at > now) break;
    const step = SCRIPT[n - 1];
    const key = `${record.id}:attempt:${n}`;
    /* Which visible scenarios this candidate moved. */
    const perScenario = Object.fromEntries(visible.map((t) => {
      const was = t.before === "passed" || !t.fromIssue;
      const h = hashSeed(`${key}:${t.id}`) % 100;
      const fixed = !step.reject ? h < 70 : h < 40;
      return [t.id, fixed && !was ? "fixed" : was && h > 96 ? "broke" : fixed ? "fixed" : "same"];
    }));
    const mustFailed = step.reject === "mustPass" ? 1 : 0;
    /* Cost is checked only where it can be measured; elsewhere the second
       model call shows up as latency instead. */
    const costKnown = record.costMeasured !== false;
    const latencyCeiling = record.limits?.latencyCeiling ?? 10;
    const cost = step.reject === "cost" ? ceiling + 6 : Math.max(0, ceiling - 3);
    const latency = step.reject === "cost" && !costKnown ? latencyCeiling + 9 : 1;
    const checks = [
      { id: "model", label: "Model unchanged", pass: true },
      costKnown
        ? { id: "cost", label: `Cost per conversation within +${ceiling}%`, actual: `+${cost}%`, pass: cost <= ceiling }
        : { id: "cost", label: `Cost per conversation within +${ceiling}%`, actual: "unverified — no cost data", pass: null },
      { id: "latency", label: `Latency within +${latencyCeiling}%`, actual: `+${latency}%`, pass: latency <= latencyCeiling },
      { id: "protected", label: "Protected parts untouched", pass: true },
      { id: "judges", label: "No scenario or evaluation edited", pass: true },
    ];
    const conversations = (visible.length + mustPass.length + (r.heldMeasured || 0)) * REPEATS;
    const spend = Math.round(conversations * per);
    /* An attempt the budget can't pay for isn't run — the session stops there. */
    if (spent + spend > budgetLeft) {
      out.overBudget = true;
      break;
    }
    spent += spend;
    out.push({
      n,
      id: `${record.id}-a${n}`,
      improver: agent.label,
      label: `${agent.label} · attempt ${n}`,
      at: new Date(at).toISOString(),
      title: step.title,
      /* An endpoint or assistant we don't control is always "deployed by
         you"; otherwise local SDK runs first, then a pushed commit. */
      where: session.where === "deployed" ? "deployed" : agent.cloud ? "future-agi" : step.where,
      commit: sha(key),
      fingerprint: step.dirty ? sha(`${key}:dirty`) : null,
      perScenario,
      visible: visible.map((t) => ({ id: t.id, title: t.title, outcome: perScenario[t.id] })),
      mustPass: { total: mustPass.length, failed: mustFailed },
      checks,
      accepted: !step.reject,
      why: step.reject === "cost" && !costKnown
        ? "Response time rose past the ceiling — the second model call adds a round trip on every turn."
        : step.why,
      spend,
    });
    if (!step.reject) break;
  }
  return out;
};

/*
  The newer session: must-pass is the engine's own three-part set (marked,
  regression memory, passing every repeat today); the visible scenarios are
  the rest of training. Each attempt carries a score on the visible set, its
  change against today, and the held-back figure Future AGI scored and never
  sent. An attempt that edits a judge is rejected at the gate.
*/
const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n)));
const attemptsV2 = (record, session, { now, surface, budgetLeft }) => {
  const r = record.result;
  const started = Date.parse(session.startedAt);
  const agent = codingAgentById(session.agentId) || { label: "Your coding agent" };
  const mustIds = new Set(r.mustPassIds || []);
  const all = [...(r.trainMeasuredTasks || []), ...(r.heldTasks || [])];
  const mustPass = all.filter((t) => mustIds.has(t.id) || t.critical || t.remembered);
  const isMust = new Set(mustPass.map((t) => t.id));
  const visible = (r.trainMeasuredTasks || []).filter((t) => !isMust.has(t.id));
  const before = visible.length ? clampPct((100 * visible.filter((t) => t.flakyToday).length * 0.5) / visible.length) : 0;
  const per = PER_CONVERSATION[surface === "voice" ? "voice" : "chat"];
  const ceiling = record.limits?.costCeiling ?? 0;
  const latencyCeiling = record.limits?.latencyCeiling ?? 10;
  const costKnown = record.costMeasured !== false;
  const reps = r.repeats || REPEATS;
  const out = [];
  let spent = 0;
  for (let n = 1; n <= Math.min(ATTEMPT_BUDGET, SCRIPT_V2.length); n += 1) {
    const at = started + n * PACE * 1000;
    if (at > now) break;
    const step = SCRIPT_V2[n - 1];
    const key = `${record.id}:attempt:${n}`;
    const files = step.files || ["agent/prompts/system.md"];
    const gate = gateOf(files);
    const base = {
      n,
      id: `${record.id}-a${n}`,
      agentId: session.agentId || null,
      improver: agent.label,
      label: `${agent.label} · attempt ${n}`,
      at: new Date(at).toISOString(),
      title: step.title,
      where: session.where === "deployed" ? "deployed" : agent.cloud ? "future-agi" : step.where,
      commit: sha(key),
      fingerprint: step.dirty ? sha(`${key}:dirty`) : null,
      files,
    };
    if (gate) {
      /* Rejected at the gate, before any run: nothing scored, nothing charged. */
      out.push({
        ...base,
        gate: true,
        perScenario: {},
        visible: visible.map((t) => ({ id: t.id, title: t.title, outcome: "not-run" })),
        mustPass: { total: mustPass.length, failed: 0, notRun: true },
        checks: [{ id: "judges", label: "No scenario or evaluation edited", actual: files.filter((f) => JUDGE_PATH.test(f)).join(", "), pass: false }],
        accepted: false,
        why: gate,
        score: null,
        delta: null,
        held: null,
        spend: 0,
      });
      continue;
    }
    const perScenario = Object.fromEntries(visible.map((t) => {
      const h = hashSeed(`${key}:${t.id}`) % 100;
      const fixed = !step.reject ? h < 70 : h < 40;
      return [t.id, fixed ? "fixed" : t.flakyToday && h > 90 ? "flaky" : "still-failing"];
    }));
    const mustFailed = step.reject === "mustPass" ? 1 : 0;
    const cost = step.reject === "cost" ? Math.max(ceiling, 0) + 6 : 0;
    const latency = step.reject === "cost" && !costKnown ? latencyCeiling + 9 : 1;
    const checks = [
      { id: "model", label: "Model unchanged", pass: true },
      costKnown
        ? { id: "cost", label: ceiling <= 0 ? "Cost per conversation · no increase" : `Cost per conversation within +${ceiling}%`, actual: `+${cost}%`, pass: cost <= Math.max(ceiling, 0) }
        : { id: "cost", label: ceiling <= 0 ? "Cost per conversation · no increase" : `Cost per conversation within +${ceiling}%`, actual: "unverified — no cost data", pass: null },
      { id: "latency", label: `Latency within +${latencyCeiling}%`, actual: `+${latency}%`, pass: latency <= latencyCeiling },
      { id: "protected", label: "Protected parts untouched", pass: true },
      { id: "judges", label: "No scenario or evaluation edited", pass: true },
    ];
    const conversations = (visible.length + mustPass.length + (r.heldMeasured || 0)) * reps;
    const spend = Math.round(conversations * per);
    if (spent + spend > budgetLeft) {
      out.overBudget = true;
      break;
    }
    spent += spend;
    const fixedN = Object.values(perScenario).filter((v) => v === "fixed").length;
    const score = visible.length ? clampPct((100 * fixedN) / visible.length) : 0;
    const hh = hashSeed(`${key}:held`);
    out.push({
      ...base,
      perScenario,
      visible: visible.map((t) => ({ id: t.id, title: t.title, outcome: perScenario[t.id] })),
      mustPass: { total: mustPass.length, failed: mustFailed },
      checks,
      accepted: !step.reject,
      why: step.reject === "cost" && !costKnown
        ? "Response time rose past the ceiling — the second model call adds a round trip on every turn."
        : step.why,
      score,
      delta: score - before,
      /* Scored by Future AGI on the held-back set, never sent to the agent. */
      held: clampPct((r.heldBase || 0) + (step.reject ? (hh % 7) - 3 : 8 + (hh % 10))),
      spend,
    });
    if (!step.reject) break;
  }
  return out;
};

/* Whether the session is still expecting another submission. */
export const sessionState = (session, attempts) => {
  if (!session) return null;
  const accepted = attempts.find((a) => a.accepted);
  if (accepted) return { key: "accepted", attempt: accepted };
  if (attempts.length >= ATTEMPT_BUDGET || attempts.overBudget) return { key: "budget", money: !!attempts.overBudget };
  return { key: "waiting" };
};

/** The proof a passing verdict produces, for the PR the coding agent opens. */
export const attemptProof = (record, attempt, name) => {
  const fixed = attempt.visible.filter((x) => x.outcome === "fixed").length;
  const broke = attempt.visible.filter((x) => x.outcome === "broke").length;
  return [
    `## Proof · ${attempt.label} · ${name || record.name} (${record.id})`,
    "",
    `**Verified by Future AGI — accepted.** Fixed ${fixed} of ${attempt.visible.length} visible scenarios, broke ${broke || "none"}; must-pass ${attempt.mustPass.total - attempt.mustPass.failed} of ${attempt.mustPass.total}.`,
    "",
    `Change: commit \`${attempt.commit}\`${attempt.fingerprint ? ` + uncommitted changes \`${attempt.fingerprint}\`` : ""} · ${TIERS[attempt.where]?.label}`,
    "",
    /* A workspace key could read the held-back set: say what the proof can promise. */
    ...(attempt.agentId !== undefined && !heldBackHiddenFrom(attempt.agentId)
      ? ["Held-back scenarios were readable by this agent — this proof promises integrity, not secrecy.", ""]
      : []),
    "### Constraints",
    ...attempt.checks.map((c) => `- ${c.pass === null ? "◌" : c.pass ? "✓" : "✗"} ${c.label}${c.actual ? ` — ${c.actual}` : ""}`),
    "",
    `_The starting version and the change ran on the same frozen scenarios and evaluations, each repeated ${REPEATS} times. The verdict was computed by Future AGI, not by ${attempt.improver}._`,
    `Full proof: https://app.futureagi.com/improvements/${record.id}/attempts/${attempt.n}`,
  ].join("\n");
};
