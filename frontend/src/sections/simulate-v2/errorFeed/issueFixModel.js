/*
  Error Feed → Fix, without React or the store: which agent an issue came
  from, the scenarios its traces make, what reproducing finds, the improvement
  record a Fix writes and where that fix stands. `issueFix.js` re-exports all
  of it next to the hook; the seed reads it from here so it can build its
  Error Feed fixes the same way a press of Start fix does.
*/
import { PER_CONVERSATION, REPEATS, improvementOutcome } from "../_mock/optimizationRuns";
import { baseRunOf, buildImprovement, improvementEstimate, planSearch, COMPAT_CHECK } from "../_mock/improvementStart";
import { improvementRunName } from "../_mock/optimizer";
import { currentAgentVersion } from "../_mock/versions";
import { isComingSoon, needsLiveConsent } from "../_mock/rsiModel";
import { agentStatusFor, mainEnvFor } from "../_mock/improvementPolicy";
import { errorFeedScenarios } from "../_mock/scenarioSources";
import { projectLinkOf, projectsOfAgent } from "../_mock/projectLinks";
import { paths } from "src/routes/paths";

/* The feed finds an issue's agent through its Observe project — the one
   link in _mock/projectLinks.js. */
/* Issues whose traces carry the agent's own id — closer evidence than the
   project they were filed under, so they go to that agent whatever the
   project is linked to. None today; each seeded project names its agent. */
const SEEDED_ISSUE_AGENTS = {};

/* The agent version an issue's traces were recorded on, where the feed has
   it — what "running in production" means when no release is recorded. */
const ISSUE_TRACE_VERSIONS = {
  "ISS-4536": "v2",
  "ISS-4529": "v1",
};

/* What each linked issue's traces look like as scenarios — the
   representative failure first, then the variations seen around it. */
const ISSUE_CASES = {
  "ISS-4501": [
    "Caller asks for the refund status straight after giving the first identity factor",
    "Caller reads the one-time code slowly; the agent starts confirming before it lands",
    "Caller interrupts the confirmation to repeat the code",
    "The identity check times out once and the caller tries again",
    "Caller asks to cancel the refund before verification completes",
  ],
  "ISS-4520": [
    "Caller asks for the refund total, then for the breakdown",
    "Partial refund with a restocking fee taken off",
    "Caller questions the amount and asks the agent to say it again",
    "Refund split across two payment methods",
  ],
  "ISS-4478": [
    "Order moved to another warehouse after it was placed",
    "Caller asks when a back-ordered item will ship",
    "Caller checks the same order twice in one call",
    "Item shows in stock, then sells out during the call",
  ],
  "ISS-4402": [
    "Caller cancels an order that falls under a policy exception",
    "Caller cancels a subscription inside the notice period",
    "Caller asks to cancel and keep a partial benefit",
    "Caller cancels after a price-match promise",
  ],
  "ISS-4536": [
    "Passenger asks for a rebooking summary after one leg of the trip was cancelled",
    "Two passengers on one booking, one with no checked bags",
    "Passenger asks for the total owed after a fare difference on one segment only",
    "Summary requested again after a segment is removed mid-chat",
  ],
  "ISS-4529": [
    "Guest corrects the booking time after first giving the wrong one",
    "Guest changes the party size while the agent reads the booking back",
    "Guest spells their name a second time to fix it",
    "Guest moves an existing booking and corrects the new date",
  ],
  "ISS-4552": [
    "Guest asks for a table for twelve on a Saturday night",
    "Guest starts with a party of eight, then adds three more",
    "Guest asks to book nine and insists it's only a small group",
    "Guest books for ten under a company name",
  ],
  "ISS-4557": [
    "Caller gives only their name and asks to move an appointment",
    "Two patients share a surname; the caller gives the first name late",
    "Caller gives the wrong date of birth, then corrects it",
    "Caller cancels on behalf of a family member",
  ],
};

/* Which cases are variations of one another — a group always lands on one
   side of the held-back split, so a near-copy can't leak into training. */
const ISSUE_GROUPS = {
  "ISS-4501": [1, 2, 2, 3, 4],
  "ISS-4520": [1, 1, 2, 3],
  "ISS-4478": [1, 2, 1, 3],
  "ISS-4402": [1, 2, 2, 3],
  "ISS-4536": [1, 2, 3, 3],
  "ISS-4529": [1, 2, 1, 3],
  "ISS-4552": [1, 2, 1, 3],
  "ISS-4557": [1, 2, 3, 3],
};

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/** The Observe project an issue's traces came from. */
export const issueProjectOf = (issue) => issue?.project_id || null;

/**
 * The agent an issue came from: the agent its traces name, else the agent
 * whose Observe project the issue's traces are in, or the one someone linked
 * that project to. A project link is per project, not per issue, so one
 * answer covers every issue from it.
 */
export const agentKeyForIssue = (issue, state, agents = []) => {
  const traced = SEEDED_ISSUE_AGENTS[issue?.cluster_id];
  if (traced) return traced;
  const link = projectLinkOf(issueProjectOf(issue), state, agents);
  return link.status === "linked" ? link.agentKey : null;
};

/** The issue's project and its agent link — see _mock/projectLinks.js. */
export const issueProjectLinkOf = (issue, state, agents = []) => projectLinkOf(issueProjectOf(issue), state, agents);

/** The Error Feed projects an agent's issues come from — its own and any linked to it. */
export const errorFeedProjectsOf = (agent, state) => projectsOfAgent(agent, state, agent ? [agent] : []).map((l) => l.project);

/** The environments that test an agent, main one first. */
/* A fix is in flight from the moment it starts until it ends unfixed or the
   issue reopens — while it is, the issue opens that fix and never a second. */
export const FIX_IN_FLIGHT = new Set(["fixing", "ready", "review", "watching", "resolved"]);

export const envsForAgent = (agent, state) => {
  const list = (agent?.usedIn || [])
    .map((u) => state.myEnvironments.find((e) => e.id === u.envId))
    .filter(Boolean);
  const main = mainEnvFor(agent, state, list);
  return main ? [main, ...list.filter((e) => e.id !== main.id)] : list;
};

/**
 * Which version of the agent is in production, and how we know: the newest
 * release recorded in any environment testing it (detected from the
 * platform or traces, or marked by hand), else the version the issue's
 * traces were recorded on. With neither, it's only the version the
 * environment tests now — and it says so instead of claiming production.
 *   { label, source: "release" | "traces" | "current", line }
 */
export const productionVersionOf = (agent, state, issue, fallbackEs) => {
  const releases = (agent?.usedIn || [])
    .flatMap((u) => (state?.byEnv?.[u.envId]?.releases || []))
    .filter((r) => r?.version && r.at)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (releases[0]) return { label: releases[0].version, source: "release", line: `${releases[0].version} · latest released version, running in production` };
  const traced = issue?.agent_version || ISSUE_TRACE_VERSIONS[issue?.cluster_id];
  if (traced) return { label: traced, source: "traces", line: `${traced} · the version this issue's traces were recorded on` };
  const current = fallbackEs ? currentAgentVersion(fallbackEs)?.label : agent?.latest;
  return { label: current || null, source: "current", line: `${current || "Current version"} · current version — no release recorded yet` };
};

/**
 * Why Fix can't start, said rather than hidden: the agent is disconnected or
 * archived, its environment is Coming soon (browser, computer use), or it runs
 * live and needs the user's consent first. Null when Fix can start.
 *   { key, title, body, action?: "connections" }
 */
export const fixGateOf = (agent, env) => {
  if (!agent) return null;
  const status = agentStatusFor(agent);
  if (status.key === "archived") {
    return { key: "archived", title: `${agent.name} is archived`, body: status.reason || "New runs and improvements are stopped. Restore the agent to fix this issue." };
  }
  if (status.key === "disconnected") {
    return { key: "disconnected", title: `${agent.name} is disconnected`, body: status.reason || "Reconnect it on the agent's Connections tab to fix this issue.", action: "connections" };
  }
  if (isComingSoon(agent) || (env && isComingSoon(env))) {
    return { key: "coming-soon", title: "Coming soon", body: "Browser and computer-use agents are coming soon. Improvements don't run on them yet." };
  }
  if (needsLiveConsent(agent)) {
    return {
      key: "consent",
      title: "Needs your consent for live tests",
      body: `${agent.name} runs live: test copies or drafts are made in your account and its tools reach your real systems. Give consent on the agent's Connections tab first.`,
      action: "connections",
    };
  }
  return null;
};

/**
 * Fix starts on confirmed issues only (RSI PRD, Risks: "Fix only on confirmed
 * issues"). An emerging, unresolved or dismissed one says why it waits and
 * what confirms it. Null when the issue is confirmed.
 */
export const evidenceGateOf = (issue) => {
  const e = issue?.evidence_state;
  if (!e || e === "confirmed") return null;
  if (e === "emerging") {
    return {
      key: "emerging",
      title: "Still emerging",
      body: `${issue.trace_count || "A few"} traces so far — the pattern is consistent but not confirmed yet. Fix opens once the feed confirms it from more traces.`,
    };
  }
  if (e === "dismissed") return { key: "dismissed", title: "Dismissed", body: "This issue was dismissed. If it comes back, the feed confirms it again and Fix opens." };
  return {
    key: "unresolved",
    title: "Not confirmed",
    body: "The feed couldn't confirm this issue from its traces, so a fix might chase noise. Fix opens once it's confirmed.",
  };
};

/**
 * Scenario drafts built from an issue's traces, for one environment. Each
 * keeps the issue and the traces it came from, so its badge links back. The
 * failing step is a critical sub-goal, and the caller's persona is inferred
 * from how the traces went — the same reading the Error Feed import does.
 */
export const issueScenarioDrafts = (issue, env, _envState) => {
  const id = issue.cluster_id;
  const cases = ISSUE_CASES[id] || [
    `As seen in production: ${issue.error?.name}`,
    "The same request from a caller in a hurry",
    "The caller corrects a detail halfway through",
    "The caller asks the agent to repeat itself",
  ];
  const traces = Math.max(cases.length, issue.trace_count || cases.length);
  const raw = cases.map((title, i) => ({
    id: `from-feed::${id}::${i + 1}`,
    groupId: `from-feed::${id}::g${(ISSUE_GROUPS[id] || [])[i] || i + 1}`,
    useCase: issue.error?.name,
    name: `${id.toLowerCase()}-${i + 1}`,
    title,
    summary: issue.error?.name,
    task: `Reproduces Error Feed issue ${id}: ${issue.error?.name}.`,
    situation: `${title}. Built from ${Math.max(1, Math.round(traces / cases.length))} of the issue's ${issue.trace_count || traces} traces.`,
    expected: `The agent handles this without repeating the issue: ${issue.error?.name.charAt(0).toLowerCase()}${issue.error?.name.slice(1)} does not happen.`,
    turns: 8,
    critical: issue.severity === "critical",
    errorFeedIssue: {
      id,
      title: issue.error?.name,
      traceIds: [0, 1, 2].map((k) => `tr_${hash(`${id}:${i}:${k}`).toString(16).slice(0, 7)}`),
    },
    env: env?.id,
  }));
  /* Persona and sub-goals as the Error Feed import reads them — the import
     runs the same reading again, which lands on the same values. */
  const read = errorFeedScenarios(raw, issue);
  return raw.map((d, i) => ({ ...d, persona: read[i]?.persona, subGoals: read[i]?.subGoals }));
};

/**
 * Does the failure actually happen on today's agent? Each scenario runs
 * three times. It counts as reproduced when it fails at least twice; once in
 * three is inconclusive — never a pass, never a reproduction, never a
 * target; never is a pass. Any reproduction is enough to search on: the
 * reproduced scenarios become what the fix must fix, the rest join the
 * scenarios it must not break. With none reproduced the run stops and says so.
 *
 * Confirmed issues reproduce on most of their scenarios, emerging ones on
 * fewer, and one the feed couldn't confirm doesn't reproduce reliably at all.
 */
export const reproduceOf = (issue, drafts = []) => {
  const evidence = issue.evidence_state || "confirmed";
  const total = drafts.length;
  const perScenario = {};
  drafts.forEach((d, i) => {
    const h = hash(`${issue.cluster_id}:${i}`) % 100;
    let fails;
    if (evidence === "unresolved") fails = i === 1 ? 1 : 0;
    else if (evidence === "emerging") fails = i < Math.max(1, total - 2) ? (h < 50 ? 3 : 2) : i === total - 2 ? 1 : 0;
    else fails = i === total - 1 && h < 50 ? 1 : h < 60 ? 3 : 2;
    perScenario[d.id] = { fails, of: REPEATS, state: fails >= 2 ? "reproduced" : fails === 1 ? "inconclusive" : "passed" };
  });
  const count = (st) => Object.values(perScenario).filter((x) => x.state === st).length;
  return { reproduced: count("reproduced"), inconclusive: count("inconclusive"), passed: count("passed"), total, perScenario };
};

/* What went wrong in each issue's traces, as the call log shows it — which
   decides what kind of change can honestly fix it. */
const ISSUE_MECHANISM = {
  "ISS-4501": { missing: "verify_identity", match: /verif|identity|auth/i },
  "ISS-4520": { unsupportedClaim: true },
  "ISS-4478": { missing: "check_inventory", match: /inventory|stock|availability/i },
  "ISS-4402": { missing: "cancel_order", match: /cancel/i, unsupportedClaim: true },
  "ISS-4536": { missing: "lookup_booking", match: /lookup_booking/i, unsupportedClaim: true },
  "ISS-4529": { missing: "modify_booking", match: /modify/i },
  "ISS-4552": { unsupportedClaim: true },
  "ISS-4557": { unsupportedClaim: true },
};

/**
 * The issue's scenarios as the search sees them, with what reproducing
 * found: reproduced ones fail and are targets; inconclusive ones (failed
 * once in three) are flaky and never targets; the rest pass today and must
 * keep passing.
 */
export const issueTasks = (issue, drafts, repro, env) => {
  const m = ISSUE_MECHANISM[issue.cluster_id] || { unsupportedClaim: true };
  const tool = m.missing ? ((env?.tools || []).find((t) => m.match?.test(t.name))?.name || m.missing) : null;
  return drafts.map((d) => {
    const r = repro?.perScenario?.[d.id] || { state: "reproduced", fails: REPEATS };
    const failing = r.state !== "passed";
    return {
      id: d.id,
      groupId: d.groupId || d.id,
      title: d.title,
      task: d.task,
      critical: !!d.critical,
      fromIssue: issue.cluster_id,
      status: r.state === "reproduced" ? "failed" : r.state === "inconclusive" ? "flaky" : "passed",
      /* Only a reproduction is something the fix must fix. */
      target: r.state === "reproduced",
      ...(r.state === "inconclusive" && { inconclusive: true }),
      passShare: (REPEATS - r.fails) / REPEATS,
      callLog: failing ? { missing: tool ? [tool] : [], unsupportedClaim: !!m.unsupportedClaim } : { missing: [] },
      evalResults: [{ name: "Task success", passed: !failing }],
      steps: [],
    };
  });
};

export const fixSeed = (es, issueId) => `fix-${issueId}-${(es?.optimizations || []).length}`;

/**
 * The improvement record a Fix writes, for Start fix and for the seed alike:
 * the environment's newest run plus the issue's scenarios, reproduced first
 * (the budget pays for that, and what's left caps the search), the issue's
 * scenarios kept with the improvement until someone adds them, and a
 * snapshot of the issue as it was when Fix was pressed.
 */
export const issueFixRecord = ({
  issue, env, es, drafts, limits, budget, regressionEnvIds, seed, state, reread, textSearch, targetMember, compatCheck = COMPAT_CHECK,
  rootCause = null,
}) => {
  const issueId = issue.cluster_id;
  const base = baseRunOf(env, es);
  const repro = reproduceOf(issue, drafts);
  return buildImprovement({
    env, es, tasks: base ? [...base.tasks, ...issueTasks(issue, drafts, repro, env)] : null, seed: seed || fixSeed(es, issueId),
    fromRunId: base?.id || null,
    baseAgentVersion: base?.agentVersion || currentAgentVersion(es)?.label || null,
    trigger: { kind: "error-feed", issueId, issueTitle: issue.error?.name, severity: issue.severity },
    limits,
    budget,
    regressionEnvIds,
    spentFirst: drafts.length * REPEATS * PER_CONVERSATION[env.surface === "voice" ? "voice" : "chat"],
    hold: !repro.reproduced,
    state,
    reread,
    textSearch,
    targetMember,
    compatCheck,
    /* Improvement-only until added from its page or the Scenarios tab. */
    issueScenarios: drafts.map((d) => ({ ...d, source: "error-feed", ...(repro.perScenario?.[d.id]?.state === "reproduced" && { target: true }) })),
    extra: {
      reproduce: repro,
      scenarioIds: drafts.map((d) => d.id),
      /* The issue as it was when Fix was pressed — it doesn't change
         after this, whatever the feed learns later. */
      snapshot: {
        issueId,
        title: issue.error?.name,
        severity: issue.severity,
        traceIds: [...new Set(drafts.flatMap((d) => d.errorFeedIssue?.traceIds || []))].slice(0, 5),
        /* The root cause the issue page showed when Fix was pressed — the Root
           cause tab's finding when there is one, else the feed's own reading.
           Diagnose starts from it (RSI PRD). */
        rootCause: rootCause?.headline || issue.why_shown || null,
        suggestedFix: rootCause?.fix || null,
        rootCauseFrom: rootCause?.source || (issue.why_shown ? "feed" : null),
        fixLayer: issue.fix_layer || null,
        /* Reproduced ones only — an inconclusive one is checked, never a target. */
        mustStartPassing: drafts.filter((d) => repro.perScenario?.[d.id]?.state === "reproduced").map((d) => d.id),
        inconclusive: drafts.filter((d) => repro.perScenario?.[d.id]?.state === "inconclusive").map((d) => d.id),
        mustKeepPassing: (base?.tasks || []).filter((t) => t.status === "passed").length,
      },
    },
  });
};

/**
 * The search a fix would run, worked out up front so its cost is a range, not
 * a guess — on the environment's scenarios plus the issue's, as if every
 * issue scenario reproduces (the dearest case).
 */
export const fixPreview = (env, es, issue, drafts, limits, { textSearch } = {}) => {
  const base = env ? baseRunOf(env, es) : null;
  if (!base || !issue) return { base, result: null };
  const tasks = [...base.tasks, ...issueTasks(issue, drafts, null, env)];
  return { base, result: planSearch({ env, es, agentVersion: base.agentVersion || currentAgentVersion(es)?.label || null, tasks, limits, seed: fixSeed(es, issue.cluster_id), textSearch }) };
};

/**
 * What a fix will spend: reproducing the issue's scenarios first, every trial
 * of the search, the held-back check, and the other environments' regression
 * scenarios for the finalists — each repeated so a lucky run can't win.
 */
export const fixEstimate = ({ preview, scenarioCount, regressionCount, surface }) => improvementEstimate({
  preview: preview?.result, surface, extraScenarios: regressionCount, firstConversations: scenarioCount * REPEATS,
});

/* How long a released fix is watched before the issue counts as resolved —
   the same 30 days fix survival is measured over. */
export const WATCH_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/* "Draft shipped · Vapi copy" — the draft's own name on its platform. */
/* Vapi has no drafts — a change ships as a copy of the assistant (RSI PRD). */
const draftLabel = (draft) => `${draft.where} ${draft.kind || (/vapi/i.test(draft.where || "") ? "copy" : "draft")}`;

/**
 * Where an issue's fix stands, read from the improvement run it started:
 * Fixing → Ready for review / No safe improvement / Could not reproduce →
 * Draft shipped (· PR #n, or · Vapi copy) → Awaiting release → Watching for
 * 30 days → Resolved, or Reopened when the issue comes back on the fixed
 * version.
 */
/**
 * Where a shipped proposal is (RSI PRD, Part 3 "Improvement states": Draft
 * shipped → Released → Watching → Resolved or Reopened). Null until it ships.
 * The Error Feed's chip and the improvement page both read this, so they
 * never disagree.
 *   { key: "review" | "watching" | "resolved" | "reopened", label, detail?, change? }
 */
export const shippedStateOf = (record, es, prs = [], { recurs = false, now = Date.now() } = {}) => {
  if (!record) return null;
  const landed = es?.handoffLandings?.[record.id];
  if (landed) {
    const release = (es?.releases || []).find((r) => r.version === landed);
    if (!release) return { key: "review", label: "Awaiting release", detail: landed };
    if (recurs) {
      /* Reopened links to the change that was meant to fix it. */
      const pr = prs.find((p) => (p.handoffKey || p.meta?.handoffKey) === record.id);
      const draft = es?.handoffDrafts?.[record.id];
      return {
        key: "reopened", label: "Reopened", detail: `seen again on ${landed}`,
        change: {
          version: landed,
          releasedAt: release.at,
          name: improvementRunName(es, record),
          via: pr ? `PR #${pr.number}` : draft ? draftLabel(draft) : null,
        },
      };
    }
    const days = Math.floor((now - Date.parse(release.at)) / DAY);
    return days >= WATCH_DAYS
      ? { key: "resolved", label: "Resolved", detail: `${landed} · ${WATCH_DAYS} days clean`, version: landed }
      : { key: "watching", label: "Watching", detail: `${WATCH_DAYS - days} days left`, version: landed };
  }
  const pr = prs.find((p) => (p.handoffKey || p.meta?.handoffKey) === record.id && p.status !== "closed");
  /* One set of words for a fix's state on every surface: Ready for review →
     Draft shipped → Awaiting release → Watching → Resolved | Reopened. */
  if (pr) return { key: "review", label: `Draft shipped · PR #${pr.number}`, via: `PR #${pr.number}` };
  const draft = es?.handoffDrafts?.[record.id];
  if (draft) return { key: "review", label: `Draft shipped · ${draftLabel(draft)}`, via: draftLabel(draft) };
  return null;
};

export const fixStatusOf = (issue, state, prs = [], now = Date.now()) => {
  const issueId = issue?.cluster_id;
  let found = null;
  state.myEnvironments.forEach((env) => {
    const es = state.byEnv[env.id];
    (es?.optimizations || []).forEach((o) => {
      if (!issueId || o.trigger?.issueId !== issueId) return;
      if (!found || Date.parse(o.createdAt) > Date.parse(found.record.createdAt)) found = { record: o, env, es };
    });
  });
  if (!found) return null;
  const { record, env, es } = found;
  const at = { envId: env.id, optId: record.id, runId: record.fromRunId };
  const { ending } = improvementOutcome(record);
  if (ending.key === "running") return { ...at, key: "fixing", label: "Fixing" };
  if (ending.key === "not-reproduced") {
    const inconclusive = record.reproduce?.inconclusive || 0;
    return { ...at, key: "not-reproduced", label: "Could not reproduce", ...(inconclusive && { detail: `${inconclusive} inconclusive` }) };
  }
  if (ending.key === "failed") return { ...at, key: "no-fix", label: "Failed for infrastructure reasons" };
  if (ending.key === "no-fix") return { ...at, key: "no-fix", label: "No safe improvement" };
  const shipped = shippedStateOf(record, es, prs, { recurs: !!issue.recurs_after_fix, now });
  if (shipped) return { ...at, ...shipped };
  if (ending.key === "budget") return { ...at, key: "ready", label: "Stopped at budget" };
  if (ending.key === "suggestion") return { ...at, key: "ready", label: "Suggestion only" };
  return { ...at, key: "ready", label: "Ready for review" };
};

/**
 * What hand triage may do while the issue has a fix (the header's Triage menu
 * and the right rail's Status both read this, so they agree). Once a fix is
 * under way it drives the issue's status — Resolve and Acknowledge say so
 * instead of competing with it.
 */
export const fixTriageRulesOf = (fixKey) => {
  const fixActive = ["fixing", "ready", "review"].includes(fixKey);
  const resolveNote = fixActive
    ? `Resolves on its own once the fix ships and stays clean for ${WATCH_DAYS} days.`
    : fixKey === "watching" ? `Ends the ${WATCH_DAYS}-day watch now and resolves the issue.`
      : fixKey === "resolved" ? "Resolved by its fix." : "";
  const ackNote = fixActive || fixKey === "watching" ? "A fix is already under way." : "";
  return {
    fixActive,
    resolveNote,
    resolveDisabled: fixActive || fixKey === "resolved",
    ackNote,
    ackDisabled: !!ackNote,
  };
};

/**
 * An issue's fix, on the improvement's own page (RSI PRD, Flow 3: "Start.
 * The improvement page opens") — not a drawer over some environment run.
 * It carries the issue along, so the page's back goes to the issue.
 * Returns [to, options] for navigate().
 */
export const issueFixNav = (at, issueId) => [
  `${paths.dashboard.simulate.improvements}/${at.envId}/${at.optId}`,
  issueId ? { state: { fromIssue: issueId } } : undefined,
];
