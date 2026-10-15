/**
 * Improvements as rows — one per improvement run, not per environment.
 *
 * Records live on the environment that scored them (`byEnv[envId].optimizations`);
 * this flattens them into what the Improvements list and an agent's
 * Improvements tab both read, so the two can't drift.
 */
import { mockCluster } from "src/api/errorFeed/mockAdapter";
import { envAgentKey, repairAgentRecord } from "../_mock/agentRegistry";
import { improvementOutcome, improvementSpend, searchMinutes, REPEATS, improvementPhaseOf } from "../_mock/optimizationRuns";
import { improvementRunName, depthOf } from "../_mock/optimizer";
import { creditsForUsd } from "../_mock/metering";
import { runIdentityOf } from "../_mock/runIdentity";
import { snapshotOfImprovement } from "../_mock/envSnapshot";
import { fixStatusOf } from "../errorFeed/issueFix";
import { improvementPath } from "./improvementNav";

/**
 * "agent v3 × env v7" for an improvement — the agent version it improved and
 * the environment version it was frozen on, named the way every run is.
 */
export const improvementIdentityOf = (record, env, es) => {
  if (!record) return null;
  const fromRun = (es?.runs || []).find((r) => r.id === record.fromRunId) || null;
  const agentVersion = record.baseAgentVersion || fromRun?.agentVersion || null;
  const envVersion = fromRun?.envVersion || record.frozen?.compat?.envVersion || null;
  if (!agentVersion && !envVersion && !env) return null;
  /* The environment version it was frozen on — stored on new records, read
     from the pins it froze on older ones. */
  const envSnapshot = env ? snapshotOfImprovement(record, env, es)?.label || null : null;
  return runIdentityOf({ agentVersion, envVersion, envSnapshot, envId: env?.id }, es, env).label;
};

/*
  What a shipped improvement became, read with the Error Feed's own fix
  lifecycle (`fixStatusOf`) on this one record: Draft shipped (PR #n, a Vapi
  copy, a Retell draft, a prompt version) → Released → Watching (n days
  left) → Resolved, or Reopened. A goal improvement is watched the same way;
  only an issue fix can come back as its issue.
*/
/* Vapi has no drafts — a change ships as a copy of the assistant (RSI PRD). */
const draftLabel = (d) => `${d.where} ${d.kind || (/vapi/i.test(d.where || "") ? "copy" : "draft")}`;

/* The run's status once its change has left Future AGI. */
const SHIPPED_STATUS = {
  draft: { key: "shipped", label: "Draft shipped" },
  pr: { key: "shipped", label: "Draft shipped" },
  version: { key: "shipped", label: "Awaiting release" },
  watching: { key: "released", label: "Watching" },
  resolved: { key: "released", label: "Resolved" },
  reopened: { key: "failed", label: "Reopened" },
};

const lifecycleOf = (record, env, es, prs, now) => {
  const key = record.trigger?.issueId || `improvement:${record.id}`;
  const narrowed = {
    myEnvironments: [env],
    byEnv: { [env.id]: { ...es, optimizations: [{ ...record, trigger: { ...(record.trigger || {}), issueId: key } }] } },
  };
  const issue = { cluster_id: key, recurs_after_fix: !!(record.trigger?.issueId && mockCluster(record.trigger.issueId)?.recurs_after_fix) };
  let st = null;
  try { st = fixStatusOf(issue, narrowed, prs, now); } catch (e) { st = null; }
  if (!st) return null;
  const landed = es?.handoffLandings?.[record.id] || null;
  const pr = prs.find((p) => (p.handoffKey || p.meta?.handoffKey) === record.id && p.status !== "closed");
  const draft = es?.handoffDrafts?.[record.id];
  const via = pr ? `PR #${pr.number}` : draft ? draftLabel(draft) : null;
  if (st.key === "watching") return { kind: "watching", label: `Released · watching, ${st.detail}`, version: landed };
  if (st.key === "resolved") return { kind: "resolved", label: `Resolved · ${landed}`, version: landed };
  if (st.key === "reopened") return { kind: "reopened", label: `Reopened · ${landed}`, version: landed };
  if (st.key === "review" && landed) return { kind: "version", label: `${landed} · awaiting release`, version: landed };
  if (st.key === "review" && pr) return { kind: "pr", label: `Draft shipped · PR #${pr.number}`, merged: pr.status === "merged" };
  if (st.key === "review" && via) return { kind: "draft", label: /Canary/.test(st.label) ? st.label : `Draft shipped · ${via}` };
  return null;
};

/*
  Where an improvement came from — the product area that started it:
  Observe (an Error Feed issue from production traces), Simulation (a run,
  a goal, a schedule or by hand) or Dataset (a dataset optimization).
*/
const SOURCE_OF = { "error-feed": "Observe", dataset: "Dataset" };

/** What started the run, in a few words, and the area it came from. */
export const triggerOf = (trigger) => ({ ...triggerOnly(trigger), source: SOURCE_OF[trigger?.kind] || "Simulation" });

const triggerOnly = (trigger) => {
  if (trigger?.kind === "error-feed") {
    return { kind: "error-feed", group: "Error Feed", label: `Error Feed · ${trigger.issueId || "issue"}` };
  }
  if (trigger?.kind === "goal") {
    return { kind: "goal", group: "Goal", label: `Goal · ${trigger.goal?.label || "Pass rate"}` };
  }
  /* A Fix on one issue in a run's Insights tab. */
  if (trigger?.kind === "run" && trigger.source === "run-insights") {
    return { kind: "run", group: "Run insights", label: `Insights · ${trigger.issueTitle || trigger.issueId || "issue"}` };
  }
  if (trigger?.kind === "run") return { kind: "run", group: "Debug failures", label: "Debug failures" };
  /* Started on its own, by the agent's automatic-improvement schedule. */
  if (trigger?.kind === "schedule") {
    return { kind: "schedule", group: "Scheduled", label: `Scheduled · ${trigger.cadence === "new-issue" ? "new issue" : "weekly"}` };
  }
  return { kind: "manual", group: "Manual", label: "Manual" };
};

/** The held-back set in short: "Fixed 3 of 4 · broke 0". */
export const heldShortOf = (outcome) => {
  const h = outcome?.held;
  if (!h) return null;
  return {
    text: h.failingBefore ? `Fixed ${h.fixed} of ${h.failingBefore}` : "Already passing",
    broke: h.broke,
  };
};

/*
  Which agent a record improved. An environment that changed agents keeps its
  older improvement runs, and those belong to the agent it tested then — the
  first one replaced after the run was created.
*/
const agentKeyAt = (es, envId, createdAt, agents) => {
  const at = Date.parse(createdAt || 0) || 0;
  const earlier = [...(es?.previousAgents || [])]
    .filter((p) => p.key && (Date.parse(p.replacedAt || 0) || 0) > at)
    .sort((a, b) => Date.parse(a.replacedAt) - Date.parse(b.replacedAt))[0];
  if (earlier) return earlier.key;
  /* The connected agent testing it now — keyed the way the Agents page keys it. */
  const now = agents.find((a) => (a.usedIn || []).some((u) => u.envId === envId));
  return now?.key || (es?.agent ? envAgentKey(repairAgentRecord(es.agent, `env:${envId}`), envId) : null);
};

/** Every improvement run in the workspace, newest first. */
export const improvementRowsOf = ({ state, agents = [], prs = [], now = Date.now() }) => {
  const byKey = new Map(agents.map((a) => [a.key, a]));
  const envName = (id) => (state?.myEnvironments || []).find((e) => e.id === id)?.name;
  return (state?.myEnvironments || []).flatMap((env) => {
    const es = state?.byEnv?.[env.id];
    return (es?.optimizations || []).map((record) => {
      const outcome = improvementOutcome(record);
      const agentKey = agentKeyAt(es, env.id, record.createdAt, agents);
      const agent = byKey.get(agentKey);
      const trigger = triggerOf(record.trigger);
      /* The other environments it was proven in, besides the one it ran in. */
      const others = (record.regressionEnvIds || []).filter((id) => id !== env.id);
      const landed = es?.handoffLandings?.[record.id];
      const pr = landed ? null : prs.find((p) => (p.handoffKey || p.meta?.handoffKey) === record.id && p.status !== "closed");
      const draft = landed || pr ? null : es?.handoffDrafts?.[record.id];
      const released = !!landed && (es?.releases || []).some((r) => r.version === landed);
      const running = outcome.ending.key === "running";
      /* A run that failed for infrastructure reasons isn't charged. */
      const spend = !running && record.result && outcome.ending.key !== "failed" ? improvementSpend(record, env.surface) : null;
      /* Fix to proposal, from what the run had to simulate — reproducing,
         every trial, the held-back check. */
      const r = record.result;
      const first = (record.scenarioIds || []).length * REPEATS;
      const minutes = r && !running
        ? record.fixDepth === "suggestion"
          ? Math.round(8 + ((r.trainMeasured + r.heldMeasured) * REPEATS + first) / (env.surface === "voice" ? 40 : 120))
          : searchMinutes(r, env.surface, { firstConversations: first })
        : null;
      const release = landed ? (es?.releases || []).find((x) => x.version === landed) : null;
      /* Running reads as where it is: Reproducing, Searching, Verifying. */
      const phase = running ? improvementPhaseOf(record, now) : null;
      const lifecycle = lifecycleOf(record, env, es, prs, now);
      /* Prompt or code — what time to proposal is measured against. */
      const changeKind = r?.winner ? (depthOf(r.winner.proposals || []) >= 3 ? "code" : "prompt") : null;
      return {
        id: `${env.id}::${record.id}`,
        envId: env.id,
        recordId: record.id,
        fromRunId: record.fromRunId || null,
        name: improvementRunName(es, record),
        envName: env.name,
        otherEnvNames: others.map(envName).filter(Boolean),
        agentKey,
        agentName: agent?.name || es?.agent?.name || `${env.name} agent`,
        trigger,
        /* Once its change ships, the run's status follows it — never "Ready
           for review" beside a released change. */
        status: phase ? { key: "running", label: phase.label, phase: phase.key } : (lifecycle && SHIPPED_STATUS[lifecycle.kind]) || outcome.ending,
        headline: outcome.headline || "",
        held: running ? null : heldShortOf(outcome),
        output: lifecycle || (landed
          ? { kind: "version", label: released ? `${landed} · released` : landed }
          : pr
            ? { kind: "pr", label: `PR #${pr.number}`, merged: pr.status === "merged" }
            : draft
              ? { kind: "draft", label: draftLabel(draft) }
              : null),
        identity: improvementIdentityOf(record, env, es),
        href: improvementPath(env.id, record.id),
        changeKind,
        scenarios: r ? r.trainMeasured + r.heldMeasured : null,
        /* What the run used, in the workspace's unit — AI credits. */
        credits: spend ? creditsForUsd(spend) : null,
        minutes,
        issueId: record.trigger?.issueId || null,
        releasedAt: release?.at || null,
        createdAt: record.createdAt || null,
      };
    });
  }).sort((a, b) => (Date.parse(b.createdAt || 0) || 0) - (Date.parse(a.createdAt || 0) || 0));
};
