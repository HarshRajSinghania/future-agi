/*
  The run digest (PRD v6 · AC-20.8, TC-20.7, §13 Q20).

  One compact message when a run finishes — never one per scenario. It goes
  wherever the workspace already sends notifications (§13 Q20: no new
  preference surface): the Slack channel the "Simulation finished" event is
  routed to in Settings → Integrations, and the workspace's notification email
  list. Score line, the run summary (pass^1 · pass^k, counts by cause), the
  top three issues as one-liners, and deep links back into the run.
*/
import { paths } from "src/routes/paths";
import { MIN_MEASURED } from "./runInsights";
import { causeCountsLine } from "./runRollup";

/* The workspace's notification email list (Settings → Notifications in the
   product). Read-only here — the digest inherits it, it doesn't configure it. */
export const ORG_NOTIFY_EMAILS = [
  { name: "Maya Chen", email: "maya.chen@acme.dev" },
  { name: "Jonas Weber", email: "jonas.weber@acme.dev" },
];

/**
 * Where a digest goes, read from the workspace's integration state.
 * { channel, emails, label, none }
 */
export const digestDestinationsOf = (integrations) => {
  const slack = integrations?.slack || null;
  const rules = slack?.rules || {};
  /* Routed like every other run_finished post; an event turned off sends nothing. */
  const channel = slack ? ("run_finished" in rules ? rules.run_finished : slack.defaultChannel) || null : null;
  const emails = ORG_NOTIFY_EMAILS;
  const people = emails.length ? `${emails.length} ${emails.length === 1 ? "person" : "people"}` : null;
  const parts = [channel, people].filter(Boolean);
  return {
    channel,
    emails,
    slackConnected: !!slack,
    none: !parts.length,
    label: parts.length ? parts.join(" and ") : null,
  };
};

const runName = (run) => (run?.ordinal ? `Run ${run.ordinal}` : "Run");

/** Deep links into the run — the app's own routes, so they open where the reader works. */
export const runLinksOf = (envId, runId) => {
  const base = paths.dashboard.simulate.simulationRun(envId, runId);
  return {
    insights: `${base}?tab=insights`,
    scenarios: `${base}?tab=tasks`,
    issue: (issueId) => `${base}?tab=insights&issue=${encodeURIComponent(issueId)}`,
  };
};

/**
 * The digest, composed from what the Insights tab already computed.
 * { title, score, summary, caveat, issues: [{ id, text, href }], more, links, lines, text }
 * `lines` is what the Slack post carries; `text` is the email body.
 */
export const runDigestOf = ({ env, run, insights, summary: rollup, label }) => {
  const links = runLinksOf(env?.id, run?.id);
  const m = insights?.measured || 0;
  const pct = m ? Math.round(((insights?.passed || 0) / m) * 100) : null;
  const low = m < MIN_MEASURED;
  const score = !m
    ? `Nothing reached a verdict — ${insights?.notMeasured?.count || 0} didn't count`
    : [
      `${insights.passed} of ${m} passed${low ? "" : ` (${pct}%)`}`,
      insights.failed ? `${insights.failed} failed` : null,
      insights.mixed ? `${insights.mixed} mixed` : null,
      ...(rollup
        ? [
          rollup.outcomes?.["test-invalid"] ? `${rollup.outcomes["test-invalid"]} test invalid` : null,
          rollup.outcomes?.error ? `${rollup.outcomes.error} error` : null,
          rollup.outcomes?.inconclusive ? `${rollup.outcomes.inconclusive} inconclusive` : null,
        ]
        : [insights.notMeasured?.count ? `${insights.notMeasured.count} didn't count` : null]),
      rollup?.pulled?.count ? `${rollup.pulled.count} pulled for review` : null,
    ].filter(Boolean).join(" · ") + (low ? " — too few for a rate" : "");
  /* The summary line: the rates, the user's bar beside them (it colours, it
     doesn't decide), and the fails by cause. */
  const causes = rollup ? causeCountsLine(rollup) : "";
  const summary = rollup && rollup.scored
    ? [
      `Run summary: ${rollup.line}${rollup.lowVolume ? "" : ` (your bar ${Math.round(rollup.bar.pass1 * 100)}%)`}`,
      causes || null,
      rollup.unreliable ? `unreliable — ${Math.round(rollup.simulatorShare * 100)}% test invalid · simulator` : null,
      rollup.stale?.line || null,
    ].filter(Boolean).join(" · ")
    : null;
  const issues = (insights?.issues || []).slice(0, 3).map((i) => ({
    id: i.id,
    severity: i.severity,
    text: `${i.title} — ${i.members.length} of ${m} scenarios${i.blockers ? ` · ${i.blockers} critical` : ""}`,
    href: links.issue(i.id),
  }));
  const more = Math.max(0, (insights?.issues || []).length - issues.length);
  const title = `${runName(run)} finished · ${label || env?.name || "Simulation"}`;
  const lines = [
    score,
    summary,
    ...(rollup?.caveat ? [rollup.caveat] : []),
    ...issues.map((i, k) => `${k + 1}. ${i.text}`),
    ...(more ? [`+${more} more in Insights`] : []),
  ].filter(Boolean);
  return {
    title,
    score,
    summary,
    caveat: rollup?.caveat || null,
    issues,
    more,
    links: [
      { label: "Open Insights", href: links.insights },
      { label: "Scenarios", href: links.scenarios },
    ],
    lines,
    text: [title, ...lines, `Open Insights: ${links.insights}`].join("\n"),
  };
};
