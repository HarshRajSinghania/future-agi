/**
 * Optimization runs — the record, not the search.
 *
 * An optimization belongs to the environment and its agent, not to the one
 * simulation run that happened to prompt it. Filing them under a run would mean
 * a team's whole optimization history vanished the day somebody tidied up their
 * runs list, and it would make "how has this agent been tuned over time" a
 * question with no screen behind it. So they live on the environment, each one
 * remembering which run it was started from.
 *
 * Every record carries the diagnosis it was created against. A search is only
 * as good as the problem statement it was given, and six weeks later "why did
 * we try that" is answerable only if the evidence travelled with the attempt.
 */

import { OPTIMIZERS, optimizerById, KIND_SURFACE, blockingVerdict, protectedHit, rejectedFor, depthOf, areaOfProposal, searchTrace, goalWords } from "./optimizer";
import { CONFIG_AREAS } from "./rsiModel";
import { creditsLabel } from "./metering";

export const OPT_STATUS = {
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  /* Started from an Error Feed issue whose failure didn't happen on today's
     agent — it stops before searching. */
  NOT_REPRODUCED: "not-reproduced",
  /* A new goal improvement where every scenario already meets the goal —
     it ends before searching. */
  NOTHING: "nothing-to-improve",
};

/**
 * Models that can drive the search.
 *
 * This is the model doing the optimizing — reading failures and writing
 * candidate prompts — not the model under test. Worth keeping separate in
 * someone's head, because the strongest available model is usually the right
 * choice here even when the agent itself runs on something cheaper.
 */
export const OPTIMIZER_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5", note: "Strongest at reading failures and writing the fix" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", note: "Faster, close behind on prompt rewriting" },
  { id: "gpt-5", label: "GPT-5", note: "Second opinion — a different model proposes differently" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Cheapest; fine for many small variations" },
];

export const optimizations = (envState) => envState?.optimizations || [];

/** Newest first, which is the only order a runs list is ever read in. */
export const optimizationList = (envState) =>
  [...optimizations(envState)].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

/** The ones a given simulation run produced. */
export const optimizationsFromRun = (envState, runId) =>
  optimizationList(envState).filter((o) => o.fromRunId === runId);

export const nextOptimizationName = (envState) =>
  `Improvement ${optimizations(envState).length + 1}`;

export const optimizationId = (envState) =>
  `OPT-${String(optimizations(envState).length + 1).padStart(5, "0")}`;

/**
 * One row's worth of headline, so the list and the detail header cannot drift.
 *
 * `heldScore` is the number that leads, never the training best — a list that
 * ranks runs by what they scored on the split they were tuned against is a
 * leaderboard of overfitting.
 */
export const optimizationSummary = (record) => {
  const r = record?.result;
  if (!r) return { headline: "—", sub: "", tone: "text.disabled" };
  if (record.status === OPT_STATUS.RUNNING) {
    return { headline: "Running", sub: `${r.trials?.length || 0} runs`, tone: "#CA8A04" };
  }
  const lift = r.heldScore - r.heldBase;
  return {
    headline: `${r.heldScore}%`,
    sub: `held back · ${lift >= 0 ? "+" : ""}${lift} from ${r.heldBase}%`,
    tone: lift > 0 ? "#16A34A" : lift < 0 ? "#DC2626" : "text.secondary",
  };
};

/** What a run is worth acting on, stated once so every surface agrees. */
export const optimizationVerdict = (record) => {
  const r = record?.result;
  if (!r) return null;
  if (r.hollow?.length) {
    return {
      tone: "#DC2626",
      title: `${r.hollow.length} of the winner's fixes have no tool evidence`,
      body: "The search found wording that passes the checks on scenarios that failed for a missing tool call. That is the self improver doing its job against a check that cannot tell the difference — fix the check before shipping this prompt.",
    };
  }
  if (r.overruled) {
    return {
      tone: "#CA8A04",
      title: `Run ${r.overruled.n} scored higher and was rejected`,
      body: r.overruled.cheats
        ? `It ${rejectedFor(r.overruled)}. The winner below is the best run that didn't cheat or break a must-pass scenario.`
        : "It broke a must-pass scenario. The winner below is the best run that did not.",
    };
  }
  /*
    A held-out set with nothing failing in it cannot show an improvement.

    It reported 96% "from 100%" and the screen called that no improvement, as
    though the search had failed to lift something liftable. It had not: every
    held-out scenario already passed, so the only thing that set could ever
    report was a regression — and here it reported one, which is the more
    serious finding and was being read as the milder one.
  */
  if (r.heldBase >= 100) {
    const broke = (r.heldTasks || []).filter((t) => r.heldPerScenario?.[t.id] === "broke");
    return r.heldScore < r.heldBase
      ? {
        tone: "#DC2626",
        title: broke.length === 1
          ? `The winner broke “${broke[0].title}”`
          : `The winner broke ${broke.length || 1} held-back scenarios`,
        body: "Every held-back scenario passed before this change and that one does not now. The held-back set was too easy to show a gain, so a regression was the only thing it could ever report — and it reported one.",
      }
      : {
        tone: "#CA8A04",
        title: "The held-back set could not test this",
        body: "Every held-back scenario already passed, so there was nothing there for the winner to improve. The held-back number is evidence of no regression, not evidence of a gain — add harder scenarios before reading a lift into it.",
      };
  }
  if (r.heldScore < r.heldBase) {
    return {
      tone: "#DC2626",
      title: `Held-back rate fell ${r.heldBase - r.heldScore} points`,
      body: "The winner scored better on the scenarios it was tuned against and worse on the ones it was not. That is the definition of a prompt fitted to its training split.",
    };
  }
  if (r.gap > 12) {
    return {
      tone: "#CA8A04",
      title: `${r.gap} points between training and held back`,
      body: "The prompt learned the scenarios it was tuned on more than it learned the task. Worth more scenarios before trusting the lift.",
    };
  }
  if (r.heldScore > r.heldBase) {
    return {
      tone: "#16A34A",
      title: `Held-back rate improved by ${r.heldScore - r.heldBase} points`,
      body: "The winner does better on scenarios the search never saw, which is the only evidence that it learned the task rather than the split.",
    };
  }
  return {
    tone: "#DC2626",
    title: "No improvement on held-back scenarios",
    body: "Whatever the training split gained did not survive contact with scenarios the search had not seen. The reasoned changes are the better route here.",
  };
};

export { OPTIMIZERS, optimizerById };

/* ── limits, spend and the outcome ─────────────────────────────────────── */

/**
 * What an improvement may change and what it must not move, until the agent
 * sets its own. The safe defaults: prompts and tool descriptions only, the
 * model untouched, cost and latency held close to where they are, and no
 * critical scenario broken.
 */
export const DEFAULT_LIMITS = {
  model: { mode: "locked", approved: [] },
  /* No increase by default (the updated RSI PRD). */
  costCeiling: 0,
  latencyCeiling: 10,
  allowed: ["prompt", "tools"],
  protected: [],
  budget: { dollars: 250, minutes: 60 },
};

/* The cost ceiling improvements were recorded against before "No increase". */
export const LEGACY_COST_CEILING = 5;
/* "No increase" reads as no increase beyond what two runs of the same agent
   already differ by — new improvements only. */
export const COST_NOISE = 2;

/*
  What an improvement may change, deepest last — a deeper change needs
  stronger proof and stricter review, and code needs the agent's code.
*/
export const SURFACES = [
  { id: "prompt", label: "Prompts", example: "Rewrite the refund instructions in the system prompt", delivered: "New prompt version, or a PR when prompts live in code" },
  { id: "tools", label: "Tool descriptions", example: "Clarify when a tool applies, or add a missing parameter", delivered: "New agent version or PR" },
  { id: "settings", label: "Agent settings", example: "Temperature, turn-taking or retrieval settings", delivered: "New agent version" },
  { id: "code", label: "Code", example: "Add a check before booking, fix a parser, change routing", delivered: "GitHub PR" },
  { id: "structure", label: "Structure", example: "Split into a router and specialists, add a retrieval step", delivered: "GitHub PR with a written rationale" },
  /* Tool code belongs to the world, which is what grades the agent — so a
     change to it is a world change: re-proved on a candidate world first,
     then compared. Off unless someone turns it on. */
  { id: "toolcode", label: "Tool code", example: "Fix a parser inside a tool handler", delivered: "A world change: new environment version, re-proved first, plus a PR" },
];

const SURFACE_LABEL = { prompt: "prompts", tools: "tool descriptions", settings: "agent settings", code: "code", structure: "structure", toolcode: "tool code" };
export const allowedLabel = (allowed = DEFAULT_LIMITS.allowed) => {
  const order = SURFACES.map((x) => x.id);
  const words = [...allowed].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((a) => SURFACE_LABEL[a] || a);
  const text = words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0] || "nothing";
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** The limits as rows, for a sheet that shows them before a run starts. */
export const modelLimitLabel = (limits, model) => (limits?.model?.mode === "approved" && limits.model.approved?.length
  ? `${[model, ...limits.model.approved.filter((m) => m !== model)].filter(Boolean).join(", ")} only`
  : model ? `Locked to ${model}` : "Locked");
export const ceilingLabel = (n) => (n <= 0 ? "No increase" : `At most +${n}%`);

/* A cost ceiling is a percentage over today, or an amount per conversation. */
export const costCeilingLabel = (limits) => (limits?.costMode === "abs" && limits.costCeilingAbs != null
  ? `At most $${Number(limits.costCeilingAbs).toFixed(2)} per conversation`
  : ceilingLabel(limits?.costCeiling ?? 5));

/* A protected part as a person reads it: a file, a tool, or a prompt section. */
export const protectedLabel = (x) => (x.startsWith("tool:") ? `tool ${x.slice(5)}`
  : x.startsWith("section:") ? `${x.slice(8).split("#")[0].replace(/^.*\//, "")} › ${x.split("#")[1]}`
    : x);

export const limitRows = (limits = DEFAULT_LIMITS, model) => [
  { id: "model", label: "Model", value: modelLimitLabel(limits, model) },
  { id: "cost", label: "Cost per conversation", value: costCeilingLabel(limits) },
  { id: "latency", label: "Latency", value: ceilingLabel(limits.latencyCeiling) },
  { id: "changes", label: "Allowed changes", value: `${allowedLabel(limits.allowed)} only` },
  ...((limits.protected || []).length ? [{ id: "protected", label: "Never edited", value: limits.protected.map(protectedLabel).join(", ") }] : []),
  ...(limits.budget ? [{ id: "budget", label: "Run budget", value: `${creditsLabel(limits.budget.dollars)} · ${limits.budget.minutes} min per improvement` }] : []),
];

/* What one simulated conversation costs, and how often each is repeated so a
   lucky run can't win. */
export const PER_CONVERSATION = { voice: 0.11, chat: 0.02 };
export const REPEATS = 3;

/*
  How many finalists were (or will be) scored on the held-back set. Before a
  search has run, the default; a search with no eligible candidate scores none.
*/
const finalistCount = (result) => (Array.isArray(result?.finalists) ? result.finalists.length : result?.winner ? 1 : 3);

/*
  Phase 2 · voice in text: a voice agent's trials can run as text
  conversations — faster and cheaper — and only finalists run as real calls.
*/
const trialKind = (result, surface) => (surface === "voice" && !result?.textSearch ? "voice" : "chat");
const finalKind = (surface) => (surface === "voice" ? "voice" : "chat");
/* Conversations a minute, by kind. */
export const RATE = { voice: 40, chat: 120 };

/* Repeats per scenario — the record's own (new improvements), else 3. */
export const repeatsOf = (x) => x?.result?.repeats || x?.frozen?.repeats || x?.repeats || REPEATS;

/*
  What a new improvement runs beyond the trials and the finalists' held-back
  check: the baseline twice, two more repeats for a code finalist, and each
  finalist once in every other environment picked. Zero for older records.
*/
const extraFinalConversations = (result) => {
  const reps = result.repeats || REPEATS;
  const calib = result.calibration ? 2 * result.calibration.scenarios * reps : 0;
  const deeper = (result.finalists || []).reduce((n, f) => n + (f.repeats && f.repeats > reps ? (f.repeats - reps) * result.heldMeasured : 0), 0);
  const envs = (result.otherEnvs || []).reduce((n, e) => n + finalistCount(result) * (e.scenarios || e.mustPass || 0) * reps, 0);
  return calib + deeper + envs;
};

/** Every conversation a search runs. */
export const searchConversations = (result) => {
  if (!result) return 0;
  const reps = result.repeats || REPEATS;
  return (result.trials.length * result.trainMeasured + finalistCount(result) * result.heldMeasured) * reps + extraFinalConversations(result);
};

/** What a search spends: every trial runs the training split, each finalist the held-out set. */
export const searchSpend = (result, surface) => {
  if (!result) return 0;
  const reps = result.repeats || REPEATS;
  return result.trials.length * result.trainMeasured * reps * PER_CONVERSATION[trialKind(result, surface)]
    + finalistCount(result) * result.heldMeasured * reps * PER_CONVERSATION[finalKind(surface)]
    + extraFinalConversations(result) * PER_CONVERSATION[finalKind(surface)];
};

/**
 * What an improvement actually spent. A Suggestion-only improvement runs no
 * candidates — only the reproduction on the agent as it runs today.
 */
export const improvementSpend = (record, surface) => {
  const r = record?.result;
  if (!r) return 0;
  if (record.fixDepth === "suggestion") return (r.trainMeasured + r.heldMeasured) * (r.repeats || REPEATS) * PER_CONVERSATION[finalKind(surface)];
  return searchSpend(r, surface);
};

/** How many trials a budget pays for, after the finalists' held-out check. */
export const trialsWithin = (result, budget, surface) => {
  const reps = result.repeats || REPEATS;
  const perTrial = result.trainMeasured * reps * PER_CONVERSATION[trialKind(result, surface)];
  const verify = (finalistCount(result) * result.heldMeasured * reps + extraFinalConversations(result)) * PER_CONVERSATION[finalKind(surface)];
  return perTrial > 0 ? Math.max(1, Math.floor((budget - verify) / perTrial)) : result.trials.length;
};

/**
 * How long a search takes, in minutes — trials at their pace, finalists at
 * theirs, plus anything run first. `allCalls` prices a voice search as if
 * every trial were a real call, to show both ways.
 */
export const searchMinutes = (result, surface, { trials, firstConversations = 0, allCalls = false } = {}) => {
  if (!result) return 0;
  const n = trials ?? result.trials.length;
  const kind = allCalls ? finalKind(surface) : trialKind(result, surface);
  const reps = result.repeats || REPEATS;
  return Math.round(8
    + (n * result.trainMeasured * reps) / RATE[kind]
    + (finalistCount(result) * result.heldMeasured * reps + extraFinalConversations(result) + firstConversations) / RATE[finalKind(surface)]);
};

/* What each kind of change does to cost and latency per conversation — a
   longer prompt costs a little, an added step costs more. Percent. */
const KIND_EFFECT = {
  "System prompt": { cost: 1, latency: 1 },
  "Tool description": { cost: 0.5, latency: 0 },
  Memory: { cost: 2, latency: -1 },
  Architecture: { cost: 4, latency: 6 },
};
/* What switching to each model does to cost and latency, against a
   mid-priced default. */
const MODEL_EFFECT = {
  "gpt-4o": { cost: 0, latency: 0 },
  "gpt-4.1": { cost: -6, latency: -4 },
  "claude-sonnet-4": { cost: 4, latency: 3 },
  "gemini-2.5-pro": { cost: 3, latency: 8 },
};
/* Cost and latency grow with what a change adds: every added line is read
   on every turn. To a tenth of a percent, so candidates can be told apart. */
const round1 = (n) => Math.round(n * 10) / 10;
export const winnerEffect = (winner) => {
  const sum = (winner?.proposals || []).reduce((a, p) => {
    const e = p.kind === "Model" ? (MODEL_EFFECT[p.model] || { cost: 2, latency: 2 }) : (KIND_EFFECT[p.kind] || { cost: 1, latency: 1 });
    const added = (p.diff || []).filter((d) => d.type === "add").reduce((n, d) => n + (d.text || "").length, 0);
    const weight = p.kind === "Model" ? 0 : added / 160;
    return { cost: a.cost + e.cost * 0.6 + weight * 0.5, latency: a.latency + e.latency * 0.6 + weight * 0.3 };
  }, { cost: 0, latency: 0 });
  /* Shorter conversations once failures are fixed (newer records carry it). */
  return { cost: round1(sum.cost - (winner?.costSavings || 0)), latency: round1(sum.latency) };
};

const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n)}%`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Everything an improvement run concluded, said once so the page, the Error
 * Feed chip and the lists agree. Six endings: Ready for review, No safe
 * improvement, Could not reproduce, Stopped at budget, Failed for
 * infrastructure reasons, and Suggestion only — for agents we can only call.
 */
/** Started more than a day ago and still not finished — timed out. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const staleSince = (rec, now = Date.now()) => {
  const at = Date.parse(rec?.startedAt || rec?.createdAt || "");
  return Number.isFinite(at) && now - at > STALE_AFTER_MS;
};

export const improvementOutcome = (record, { model } = {}) => {
  const r = record?.result;
  const limits = record?.limits || DEFAULT_LIMITS;
  if (record?.status === OPT_STATUS.NOTHING) {
    return { ending: { key: "nothing", label: "Nothing to improve" }, headline: `Nothing to improve — every scenario already meets ${goalWords(record.nothing?.goal)}.` };
  }
  if (record?.status === OPT_STATUS.NOT_REPRODUCED) {
    return { ending: { key: "not-reproduced", label: "Could not reproduce" }, headline: "The failure didn't happen on today's agent, so there was nothing to fix." };
  }
  if (record?.status === OPT_STATUS.FAILED) {
    return {
      ending: { key: "failed", label: "Failed for infrastructure reasons" },
      headline: `${record.infra?.reason || "The environment couldn't run the search."} An infrastructure problem, not the agent — no run was counted as a pass or a fail, and the crashed runs aren't charged to the budget.`,
    };
  }
  /* A run that's reported nothing for a day has stopped — the engine times
     it out as an infrastructure failure instead of showing it running. */
  if (record?.status === OPT_STATUS.RUNNING && staleSince(record)) {
    return {
      ending: { key: "failed", label: "Failed for infrastructure reasons" },
      headline: "It stopped reporting progress more than a day ago and was timed out. An infrastructure problem, not the agent — nothing it hadn't finished was charged. Start it again to retry.",
    };
  }
  if (record?.status === OPT_STATUS.RUNNING || !r) return { ending: { key: "running", label: "Running" } };
  /*
    Suggestion only: we can only call this agent, so the improvement
    reproduces the failure and ends with a diagnosis and a suggested fix —
    no candidate was tried, so there is no proof. Once the fix is applied and
    the new version released, a re-run on the same environment version proves it.
  */
  if (record?.fixDepth === "suggestion") {
    const suggestion = suggestedFixOf(record);
    const all = r.trainMeasured + r.heldMeasured;
    const reproduced = record.reproduce
      ? `Reproduced ${record.reproduce.reproduced} of ${plural(record.reproduce.total, "scenario")} from ${record.trigger?.issueId || "the issue"}`
      : `Reproduced the failures on ${r.failingToday ?? "some"} of ${plural(all, "scenario")}`;
    return {
      ending: { key: "suggestion", label: "Suggestion only" },
      headline: `${reproduced}. A diagnosis and a suggested fix — not proven: we can only call this agent, so no change could be tried.`,
      suggestion,
      checks: [],
      held: null,
      issue: issueOutcome({ ...record, result: { ...r, winner: null } }),
    };
  }

  const winner = r.winner;
  const held = { fixed: 0, broke: 0, stillFailing: 0, unchanged: 0, flaky: 0, inconclusive: 0 };
  Object.values(r.heldPerScenario || {}).forEach((v) => {
    if (v === "fixed") held.fixed += 1;
    else if (v === "broke") held.broke += 1;
    else if (v === "still-failing") held.stillFailing += 1;
    else if (v === "flaky") held.flaky += 1;
    else if (v === "inconclusive") held.inconclusive += 1;
    else held.unchanged += 1;
  });
  /* Flaky and inconclusive ones failed before and aren't fixed now. */
  held.failingBefore = held.fixed + held.stillFailing + held.flaky + held.inconclusive;
  const effect = winnerEffect(winner);
  const surfaces = [...new Set((winner?.proposals || []).filter((p) => p.kind !== "Model").map((p) => KIND_SURFACE[p.kind] || "code"))]
    .sort((a, b) => ["prompt", "tools", "code"].indexOf(a) - ["prompt", "tools", "code"].indexOf(b));
  const offLimits = surfaces.filter((x) => !limits.allowed.includes(x));
  const blockersBroken = (r.heldBlockers || []).length;
  const heldCheats = r.heldCheats || [];

  const costKnown = record?.costMeasured !== false;
  const switched = (winner?.proposals || []).find((p) => p.kind === "Model")?.model || null;
  const worldChange = (winner?.proposals || []).filter((p) => p.worldChange);
  const hitProtected = [...new Set((winner?.proposals || []).map((p) => protectedHit(p, limits.protected || [])).filter(Boolean))];
  /* The newer engine's rows — only on records stamped with them. */
  const fz = record?.frozen || {};
  const tol = fz.costNoise && (limits.costCeiling ?? 0) <= 0 ? COST_NOISE : 0;
  const costLabel = (limits.costCeiling ?? 0) <= 0 && fz.costNoise ? "Cost per conversation · no increase" : `Cost per conversation within +${limits.costCeiling}%`;
  const areas = fz.areaCheck ? [...new Set((winner?.proposals || []).map((p) => p.area || areaOfProposal(p)).filter(Boolean))] : [];
  const areaWord = (id) => CONFIG_AREAS.find((a) => a.id === id)?.label || id;
  const offAreas = fz.areaCheck && limits.areas ? areas.filter((a) => limits.areas[a] === false) : [];
  const chosenFinalist = (r?.finalists || []).find((f) => f.winner) || null;
  const envRuns = fz.multiEnv ? chosenFinalist?.envs || null : null;
  const deepWinner = fz.depthRule && winner ? depthOf(winner.proposals || []) >= 3 : false;
  const lift = r ? r.heldScore - r.heldBase : 0;
  const checks = winner ? [
    ...(fz.staticCheck ? [{ id: "static", label: "Static checks", actual: "areas, protected parts, settings in range, judges untouched", pass: !winner.static || winner.static.pass !== false }] : []),
    {
      id: "model",
      label: limits.model?.mode === "approved" ? "Model on the approved list" : "Model unchanged",
      actual: switched ? `${model ? `${model} → ` : "switches to "}${switched}` : model || "unchanged",
      pass: !switched || (limits.model?.mode === "approved" && (limits.model.approved || []).includes(switched)),
    },
    costKnown && limits.costMode === "abs" && limits.costCeilingAbs != null
      ? (() => {
        /* An amount: today's cost per conversation, moved by the change. */
        const today = PER_CONVERSATION[record.surface === "voice" ? "voice" : "chat"];
        const after = today * (1 + effect.cost / 100);
        return { id: "cost", label: `Cost per conversation under $${Number(limits.costCeilingAbs).toFixed(2)}`, actual: `$${after.toFixed(3)} (${signed(effect.cost)})`, pass: after <= limits.costCeilingAbs };
      })()
      : costKnown
      ? { id: "cost", label: costLabel, actual: `${signed(effect.cost)}${tol && effect.cost > 0 && effect.cost <= tol ? ` · within the ±${tol}% two runs differ by` : ""}`, pass: effect.cost <= limits.costCeiling + tol }
      /* No cost data from this agent: unverified, never passed. */
      : { id: "cost", label: costLabel, actual: "Unverified — this agent reports no cost", pass: null },
    { id: "latency", label: `Latency within +${limits.latencyCeiling}%`, actual: signed(effect.latency), pass: effect.latency <= limits.latencyCeiling },
    { id: "changes", label: `${allowedLabel(limits.allowed)} only`, actual: offLimits.length ? `also ${offLimits.map((x) => SURFACE_LABEL[x]).join(", ")}` : allowedLabel(surfaces).toLowerCase() || "no change", pass: !offLimits.length },
    ...(fz.areaCheck && areas.length ? [{ id: "areas", label: "Only areas this agent allows", actual: offAreas.length ? `changes ${offAreas.map(areaWord).join(", ")}` : areas.map(areaWord).join(", "), pass: !offAreas.length }] : []),
    ...((limits.protected || []).length ? [{ id: "protected", label: "Protected parts untouched", actual: hitProtected.length ? `edits ${hitProtected.join(", ")}` : "untouched", pass: !hitProtected.length }] : []),
    ...(winner.compat ? [{ id: "compat", label: "Fits the sealed environment", actual: winner.compat.pass ? "entry point, build and start command unchanged" : winner.compat.reason, pass: !!winner.compat.pass }] : []),
    ...(winner.repoTests ? [{ id: "repoTests", label: "The repository's own tests still pass", actual: `${winner.repoTests.command} · ${winner.repoTests.pass ? "passed" : "failed"}`, pass: !!winner.repoTests.pass }] : []),
    {
      id: "blockers",
      label: "No must-pass failure repeated on a re-run",
      actual: blockersBroken
        ? `${plural(blockersBroken, "failed", "failed")} again`
        : `none of ${r.mustPass?.total ?? "the"} must-pass${(r.flakyToday || []).length ? ` · ${(r.flakyToday || []).length} flaky, not counted` : ""}`,
      pass: !blockersBroken,
    },
    /* fail · cheat on any run of the winner — an off-limits tool or a canary
       reached — and it's out, whatever it scored. */
    {
      id: "cheats",
      label: "No cheats",
      actual: heldCheats.length
        ? heldCheats[0].signal === "canary" ? `reached the goal on the canary “${heldCheats[0].title}”` : `called ${heldCheats[0].tool}`
        : r.scope?.canaries || r.scope?.offLimits ? "none caught" : "nothing to check — no canaries or off-limits tools",
      pass: !heldCheats.length,
    },
    /* A candidate never changes the rules it's graded against — a rule
       change is a spec change, decided by a person outside the loop. */
    { id: "rules", label: "No tested rule changed", actual: "rules untouched", pass: true },
    ...(worldChange.length ? [{ id: "world", label: "World change re-proved first", actual: `${worldChange.map((p) => p.step).join(", ")} · changed world`, pass: true }] : []),
    ...(fz.calibration && r?.calibration ? [{
      id: "calibration",
      label: "Gain clears the measured noise",
      actual: `${lift >= 0 ? "+" : "−"}${Math.abs(lift)} pts against ±${r.noise} · baseline twice: ${r.calibration.disagreed} of ${r.calibration.scenarios} disagreed`,
      /* A fix is judged on its issue's scenarios; a held-back set already
         passing can only show a regression. */
      pass: isIssueFix(record) || r.heldBase >= 100 || !!r.split?.thin || lift > (r.noise || 0),
    }] : []),
    ...(envRuns?.length ? [{
      id: "envs",
      label: "Must-pass held in every environment",
      actual: envRuns.map((e) => (e.held ? `${e.name} · ${e.mustPass} held` : `${e.name} · “${e.broke.title}” failed twice`)).join(" · "),
      pass: envRuns.every((e) => e.held),
    }] : []),
    ...(deepWinner ? [{ id: "depth", label: "Deeper change, stronger proof", actual: `Code change → ${chosenFinalist?.repeats || repeatsOf(record) + 2} repeats per finalist and the full regression set${winner.repoTests ? ", repository tests" : ""}`, pass: true }] : []),
  ] : [];
  const failedCheck = checks.find((c) => c.pass === false);

  const fixedLine = held.failingBefore
    ? `Fixed ${held.fixed} of ${held.failingBefore} failing ${held.failingBefore === 1 ? "scenario" : "scenarios"} on the held-back set`
    : "The held-back set was already passing";
  const costText = costKnown ? `cost per conversation ${signed(effect.cost)}` : "cost not measured";
  const result = `${fixedLine}, broke ${held.broke ? held.broke : "none"}, ${costText}`;

  const issue = issueOutcome(record);
  /*
    A fix is judged on its issue first. Held-back scenarios from the rest of
    the suite not moving is fine for a fix — they must not break, and the
    critical-scenario and regression checks still apply. Only a broken
    must-pass scenario, a cheat or a held-back regression stops it.
  */
  const fixesIssue = !!issue?.fixed;
  const soft = optimizationVerdict(record);
  const blocking = blockingVerdict(r)
    || (soft?.tone === "#DC2626" && !(fixesIssue && r.heldScore >= r.heldBase) ? soft : null);
  const base = {
    held, effect, costKnown, checks, issue, worldChange: worldChange.map((p) => p.step), noise: r.noise, stoppedEarly: r.stoppedEarly, shallower: r.shallower, train: winner ? { from: r.base, to: winner.score } : null,
    /* Too few reproduced to hold any back. */
    thin: !!r.split?.thin,
    finalists: r.finalists || [],
  };
  if (!winner) {
    return { ...base, ending: { key: "no-fix", label: "No safe improvement" }, headline: `No safe improvement — ${blockingVerdict(r).title.replace(/^No eligible winner — /, "")}.` };
  }
  if (failedCheck) {
    /* Said as what the candidate would do, not as the rule it failed. */
    const why = {
      cost: `it would raise cost per conversation ${failedCheck.actual}, over the ${limits.costMode === "abs" ? `$${Number(limits.costCeilingAbs).toFixed(2)}` : (limits.costCeiling ?? 0) <= 0 ? "no-increase" : `+${limits.costCeiling}%`} limit`,
      latency: `it would slow responses by ${failedCheck.actual}, over the +${limits.latencyCeiling}% limit`,
      changes: `it changes ${offLimits.map((x) => SURFACE_LABEL[x]).join(" and ")}, which this agent's constraints don't allow`,
      protected: `it edits ${hitProtected.join(", ")}, which this agent protects`,
      blockers: (r.heldBlockers || []).length === 1
        ? `it failed the must-pass scenario “${r.heldBlockers[0].title.replace(/\.$/, "")}” on the held-back set, and again on a re-run`
        : `it failed ${blockersBroken} must-pass scenarios on the held-back set, each again on a re-run`,
      repoTests: `it breaks the repository's own tests (${winner.repoTests?.command})`,
      compat: "it doesn't fit the sealed environment — rebuild the environment from its commit to test it",
      cheats: `it cheated on the held-back set — it ${failedCheck.actual}`,
      areas: `it ${failedCheck.actual}, which this agent's constraints don't allow`,
      calibration: `gained ${lift >= 0 ? "+" : "−"}${Math.abs(lift)} pts on the held-back set, within the noise its baseline-twice run measured (±${r.noise})`,
      envs: `failed a must-pass scenario in ${(envRuns || []).filter((e) => !e.held).map((e) => e.name).join(" and ")}, and again on a re-run`,
    }[failedCheck.id] || failedCheck.label.toLowerCase();
    return { ...base, ending: { key: "no-fix", label: "No safe improvement" }, headline: `No safe improvement — the best run ${why.replace(/^it /, "")}.` };
  }
  if (blocking) {
    return { ...base, ending: { key: "no-fix", label: "No safe improvement" }, headline: `No safe improvement — ${blocking.title.charAt(0).toLowerCase()}${blocking.title.slice(1)}.` };
  }
  /* A fix that improved the suite but not the issue it was started for isn't
     a fix for that issue — said plainly rather than shipped under its name. */
  if (issue && issue.targets && !issue.fixed) {
    return { ...base, ending: { key: "no-fix", label: "No safe improvement" }, headline: `No fix for ${issue.id} — the best run didn't fix it on any of the ${plural(issue.targets, "scenario")} where it failed.` };
  }
  /* Fixed only where the search could see it: fitted, not fixed. */
  if (issue && issue.held && !issue.heldFixed) {
    return { ...base, ending: { key: "no-fix", label: "No safe improvement" }, headline: `No fix for ${issue.id} — the best run fixed it on scenarios the search saw, but not on the ${issue.held === 1 ? "one" : issue.held} it never saw.` };
  }
  /*
    Beyond run-to-run noise. For a goal or a run's failures, the held-back
    gain has to clear what two runs of the same agent already differ by. A
    fix is judged on its issue's scenarios instead — each fixed on every
    repeat, which noise doesn't do.
  */
  if (!issue && r.heldBase < 100 && r.heldScore - r.heldBase <= (r.noise || 0)) {
    return {
      ...base,
      ending: { key: "no-fix", label: "No safe improvement" },
      headline: `No safe improvement — the held-back gain (${r.heldScore - r.heldBase >= 0 ? "+" : "−"}${Math.abs(r.heldScore - r.heldBase)} pts) is within run-to-run noise (±${r.noise}).`,
    };
  }
  /* A fix leads with its issue; the rest of the held-back set is the next line. */
  const said = issue?.targets
    ? `Fixed ${issue.id} on ${issue.fixed} of ${plural(issue.targets, "scenario")} where it failed, broke ${held.broke ? held.broke : "none"}, ${costText}`
    : result;
  if (record.stoppedAtBudget) {
    const s = record.stoppedAtBudget;
    const limit = s.by === "time" ? `${s.minutes}-minute limit` : `$${s.budget} budget`;
    return { ...base, ending: { key: "budget", label: "Stopped at budget" }, headline: `Stopped at the ${limit} after ${s.trials} of ${s.of} runs. Best so far: ${said.charAt(0).toLowerCase()}${said.slice(1)}.` };
  }
  return { ...base, ending: { key: "ready", label: "Ready for review" }, headline: `${said}.` };
};

/**
 * The fix a Suggestion-only improvement hands over: the search's pick, or
 * else the changes that address the most failing scenarios.
 */
export const suggestedFixOf = (record) => {
  const r = record?.result;
  if (!r) return [];
  if (r.winner?.proposals?.length) return r.winner.proposals;
  return [...(r.pool || [])].sort((a, b) => (b.addresses?.length || 0) - (a.addresses?.length || 0)).slice(0, 2);
};

/* A fix judged on its issue first: Fix on an Error Feed issue, or on an issue
   from a run's Insights tab. */
export const isIssueFix = (record) => record?.trigger?.kind === "error-feed" || record?.trigger?.source === "run-insights";

/**
 * For a fix from the Error Feed or a run's Insights: what the winner did to
 * the issue itself, on the scenarios where it failed — including the ones the
 * search never saw. Null for any other improvement.
 */
export const issueOutcome = (record) => {
  const r = record?.result;
  const id = isIssueFix(record) ? record.trigger.issueId : null;
  if (!id || !r) return null;
  /* Inconclusive scenarios aren't targets (new improvements). */
  const target = (t) => t.fromIssue === id && t.before !== "passed" && !(record.frozen?.inconclusiveOut && t.before === "flaky");
  const trainT = (r.trainMeasuredTasks || []).filter(target);
  const heldT = (r.heldTasks || []).filter(target);
  const trainFixed = trainT.filter((t) => r.winner?.perScenario?.[t.id] === "fixed").length;
  const heldFixed = heldT.filter((t) => r.heldPerScenario?.[t.id] === "fixed").length;
  return {
    id,
    targets: trainT.length + heldT.length,
    fixed: r.winner ? trainFixed + heldFixed : 0,
    held: heldT.length,
    heldFixed: r.winner ? heldFixed : 0,
  };
};

/** The issue line under a fix's verdict. */
export const issueLine = (issue, held, { thin = false } = {}) => {
  if (!issue?.targets) return null;
  if (thin || !issue.held) {
    return thin
      ? "Held-back check is thin: too few of the issue's scenario groups reproduced to hold any back, so this rests on scenarios the search saw."
      : "None of the issue's scenarios were held back, so this rests on scenarios the search saw.";
  }
  const own = issue.held === 1
    ? `The one issue scenario the search never saw ${issue.heldFixed ? "is fixed" : "still fails"}`
    : `${issue.heldFixed} of the ${issue.held} issue scenarios the search never saw are fixed`;
  const restFailing = held ? held.failingBefore - issue.held : 0;
  const rest = held && restFailing > 0
    ? `; on the rest of the held-back set it fixed ${held.fixed - issue.heldFixed} of ${restFailing} other failing scenarios`
    : "";
  return `${own}${rest}.`;
};

/*
  How a candidate is proven, cheapest first; it stops at the first tier it
  fails. Static checks (model, protected parts, nothing touching the judges;
  for a code change, that it fits the sealed environment — same entry point,
  build and start command — and the repository's own tests), no cheats on any of its
  runs (off-limits tools, canaries), the target scenarios, the held-back set
  — scored once, at the end, for finalists only — the must-pass set (a
  failure counts only when it repeats on a re-run), and repeats.
*/
export const ladderOf = (record, trial) => {
  const r = record?.result;
  if (!r || !trial) return [];
  const isWinner = r.winner?.n === trial.n;
  const finalist = (r.finalists || []).find((f) => f.n === trial.n) || null;
  const caught = [...(trial.cheats || []), ...(isWinner ? r.heldCheats || [] : [])];
  const checked = [
    r.scope?.canaries ? `${r.scope.canaries} ${r.scope.canaries === 1 ? "canary" : "canaries"} held` : null,
    r.scope?.offLimits ? "no off-limits calls" : null,
  ].filter(Boolean).join(" · ");
  const tests = trial.repoTests || null;
  /* Only code candidates in an improvement stamped with the check carry it. */
  const compat = trial.compat || null;
  /* Stamped records check statics for real, and say what deeper proof a code change got. */
  const fz = record.frozen || {};
  const stat = fz.staticCheck ? trial.static || { pass: true } : null;
  const reps = fz.repeats || REPEATS;
  const tiers = [
    stat
      ? { id: "static", label: "Static checks", state: stat.pass ? "pass" : "fail", note: stat.pass ? "model, protected parts, areas, settings in range, judges untouched" : `${stat.reason} It stops here.` }
      : { id: "static", label: "Static checks", state: "pass", note: "model, protected parts, judges untouched" },
    ...(compat ? [{ id: "compat", label: "Fits the environment", state: compat.pass ? "pass" : "fail", note: compat.pass ? compat.note || "entry point, build and start command unchanged" : `${compat.reason} It stops here.` }] : []),
    ...(tests ? [{ id: "repoTests", label: "Repository tests", state: tests.pass ? "pass" : "fail", note: tests.pass ? `${tests.command} · still pass` : `${tests.command} · failed — it stops here` }] : []),
    caught.length
      ? { id: "cheats", label: "No cheats", state: "fail", note: `fail · cheat — ${caught[0].signal === "canary" ? `reached the goal on the canary “${caught[0].title}”` : `called ${caught[0].tool} on “${caught[0].title}”`}` }
      : { id: "cheats", label: "No cheats", state: "pass", note: checked || "no canaries or off-limits tools to check" },
    /* Stamped records hold every candidate to cost and latency as it runs. */
    ...(stat ? [{ id: "limits", label: "Cost and latency", state: trial.overLimit ? "fail" : "pass", note: trial.overLimit ? `${trial.overLimit.actual} — dropped here` : "within the agent's ceilings" }] : []),
    /* A run issue's Fix targets the issue's scenarios; anything else targets
       the training split. */
    typeof trial.issueFixed === "number" && trial.issueTargets
      ? { id: "target", label: "Target scenarios", state: trial.issueFixed > 0 ? "pass" : "fail", note: trial.issueFixed > 0 ? `fixed ${trial.issueFixed} of ${trial.issueTargets} issue ${trial.issueTargets === 1 ? "scenario" : "scenarios"} in training` : "didn't fix the issue's scenarios" }
      : typeof trial.goalFixed === "number" && trial.goalTargets
        ? { id: "target", label: "Target scenarios", state: trial.goalFixed > 0 && trial.delta > 0 ? "pass" : "fail", note: trial.goalFixed > 0 ? `fixed ${trial.goalFixed} of ${trial.goalTargets} short of ${goalWords(r.goal)} in training · ${trial.delta >= 0 ? "+" : "−"}${Math.abs(trial.delta)} pts` : `fixed none of the ${trial.goalTargets} short of ${goalWords(r.goal)}` }
        : { id: "target", label: "Target scenarios", state: trial.delta > 0 ? "pass" : "fail", note: trial.delta > 0 ? `+${trial.delta} pts on training` : "no gain on the scenarios it was for" },
    { id: "held", label: "Held-back set", state: "todo", note: "" },
    { id: "mustpass", label: "Must-pass set", state: "todo", note: "" },
    { id: "repeats", label: "Repeats", state: "todo", note: "" },
  ];
  /* A tool-code change rebuilds the world first: the scenarios using that
     tool are re-proved on the candidate world before anything is compared. */
  const world = (r.pool || []).filter((p) => trial.picks.includes(p.id) && p.worldChange);
  const finish = (t) => (world.length
    ? [t[0], { id: "world", label: "Changed world re-proved", state: "pass", note: `tool code in ${world.map((p) => p.step).join(", ")} — scenarios using it re-proved first` }, ...t.slice(1)]
    : t);
  const at = (id) => tiers.findIndex((t) => t.id === id);
  const set = (id, patch) => { tiers[at(id)] = { ...tiers[at(id)], ...patch }; };
  const after = (id) => tiers.slice(at(id) + 1).map((t) => t.id).filter((x) => x !== "world");
  if (stat && !stat.pass) {
    after("static").forEach((id) => set(id, { state: "skip", note: "not run — it failed a static check" }));
    return finish(tiers);
  }
  if (compat && !compat.pass) {
    after("compat").forEach((id) => set(id, { state: "skip", note: "not run — it doesn't fit the sealed environment" }));
    return finish(tiers);
  }
  if (tests && !tests.pass) {
    after("repoTests").forEach((id) => set(id, { state: "skip", note: "stopped at the repository's tests" }));
    return finish(tiers);
  }
  if (tiers[at("cheats")].state === "fail") {
    ["limits", "target", "held", "mustpass", "repeats"].filter((id) => at(id) >= 0).forEach((id) => set(id, { state: "skip", note: "rejected — a run that cheats goes no further" }));
    return finish(tiers);
  }
  if (at("limits") >= 0 && tiers[at("limits")].state === "fail") {
    ["target", "held", "mustpass", "repeats"].forEach((id) => set(id, { state: "skip", note: "not a finalist — over the agent's limits" }));
    return finish(tiers);
  }
  if (tiers[at("target")].state === "fail") return finish(tiers);
  const repeated = (trial.mustPassFails || []).filter((f) => f.repeated);
  const once = (trial.mustPassFails || []).filter((f) => !f.repeated);
  if (!finalist) {
    set("held", { state: "skip", note: trial.brokeBlocker ? "not a finalist — a must-pass failure repeated in training" : "not a finalist" });
    if (trial.brokeBlocker) set("mustpass", { state: "fail", note: `“${repeated[0]?.title || "a must-pass scenario"}” failed, and again on a re-run` });
    return finish(tiers);
  }
  const thin = !!r.split?.thin;
  const lift = finalist.heldScore - r.heldBase;
  const heldNote = thin
    ? "held-back check is thin — too few groups reproduced to hold any back"
    : `${finalist.pick ? "finalist 1" : "finalist"} · scored once at the end · ${lift >= 0 ? "+" : "−"}${Math.abs(lift)} pts · noise ±${r.noise || 0}${r.calibration ? " measured by running the baseline twice" : ""}`;
  set("held", { state: thin ? "thin" : finalist.accepted ? "pass" : "fail", note: finalist.accepted || thin ? heldNote : `${heldNote} · ${finalist.why}` });
  if (tiers[at("held")].state === "fail" && finalist.why !== "a must-pass scenario failed again on a re-run" && finalist.why !== "cheated on the held-back set") return finish(tiers);
  const blockers = isWinner ? r.heldBlockers || [] : finalist.why === "a must-pass scenario failed again on a re-run" ? [{}] : [];
  const parts = r.mustPass ? `${r.mustPass.total} must-pass` : "must-pass";
  /* Each other environment picked: its must-pass set held, or which broke. */
  const envBroke = fz.multiEnv ? (finalist.envs || []).find((e) => !e.held) : null;
  const envNote = fz.multiEnv && (finalist.envs || []).length ? ` · held in ${finalist.envs.filter((e) => e.held).map((e) => e.name).join(", ") || "no other environment"}` : "";
  set("mustpass", {
    state: blockers.length || envBroke ? "fail" : "pass",
    note: blockers.length
      ? `${blockers[0].title ? `“${blockers[0].title}”` : "a must-pass scenario"} failed, and again on a re-run`
      : envBroke
        ? `“${envBroke.broke.title}” failed in ${envBroke.name}, and again on a re-run`
        : `${parts} held${envNote}${once.length ? ` · ${once.length} failed once and passed the re-run — not counted` : ""}${(r.flakyToday || []).length ? ` · ${(r.flakyToday || []).length} flaky today, never disqualifying` : ""}`,
  });
  if (tiers[at("mustpass")].state === "fail") return finish(tiers);
  set("repeats", {
    state: "pass",
    note: fz.depthRule && finalist.fullRegression
      ? `Code change → ${finalist.repeats} repeats per finalist and the full regression set · flips counted only when they repeat`
      : `each scenario ${fz.depthRule ? finalist.repeats || reps : REPEATS}×, flips counted only when they repeat`,
  });
  return finish(tiers);
};

/* The judge comes from a different model family than the proposer, so the
   proposer never grades its own work. */
export const judgeFor = (proposerId = "") => (/claude/i.test(proposerId) ? "GPT-5" : "Claude Sonnet 5");

/* ── where a running improvement is ────────────────────────────────────── */

/*
  Draft → Reproducing → Searching → Verifying, derived from the step of its
  trace it has reached — timed the way the trace plays (`RunTrace`), from
  when the run started. Null once it has ended.
*/
export const IMPROVEMENT_PHASES = {
  draft: "Draft",
  reproducing: "Reproducing",
  diagnosing: "Diagnosing",
  searching: "Searching",
  verifying: "Verifying",
};
const STEP_PHASE = {
  reread: "reproducing", reproduce: "reproducing", calibrate: "reproducing",
  diagnose: "diagnosing", split: "searching", candidates: "searching", trials: "searching",
  holdout: "verifying", suggest: "verifying",
};
export const TRACE_STEP_MS = 800;
const stepDuration = (s, stepMs = TRACE_STEP_MS) => {
  const n = (s.lines || []).length;
  return n * Math.max(180, stepMs / (n + 1)) + stepMs * 0.55;
};
export const improvementPhaseOf = (record, now = Date.now()) => {
  if (record?.status === "draft") return { key: "draft", label: IMPROVEMENT_PHASES.draft };
  if (record?.status !== OPT_STATUS.RUNNING) return null;
  const r = record.result;
  if (!r) return { key: "draft", label: IMPROVEMENT_PHASES.draft };
  const steps = searchTrace(r, record);
  const elapsed = Math.max(0, now - (Date.parse(record.startedAt || record.createdAt || 0) || now));
  let t = 0;
  for (const s of steps) {
    t += stepDuration(s);
    if (elapsed < t) {
      const key = STEP_PHASE[s.id] || "searching";
      return { key, label: IMPROVEMENT_PHASES[key], step: s.id };
    }
  }
  return { key: "verifying", label: IMPROVEMENT_PHASES.verifying, step: steps[steps.length - 1]?.id };
};

/**
 * A running improvement whose search has played out is finished — whether or
 * not anyone had it open. Without this it sat on Verifying until its page was
 * opened, and a day later read as an infrastructure failure. Applied when the
 * store loads.
 */
export const settleImprovements = (es, now = Date.now()) => {
  const list = es?.optimizations || [];
  if (!list.some((o) => o.status === OPT_STATUS.RUNNING && o.result)) return es;
  let changed = false;
  const optimizations = list.map((o) => {
    if (o.status !== OPT_STATUS.RUNNING || !o.result) return o;
    const start = Date.parse(o.startedAt || o.createdAt || "") || now;
    const done = start + searchTrace(o.result, o).reduce((t, s) => t + stepDuration(s), 0);
    if (now < done) return o;
    changed = true;
    return { ...o, status: OPT_STATUS.COMPLETED, completedAt: new Date(done).toISOString() };
  });
  return changed ? { ...es, optimizations } : es;
};
