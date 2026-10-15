/**
 * Error Feed issues, read as an Add scenarios source.
 *
 * An issue is a failure the Error Feed has grouped across production traces.
 * Its scenarios are the ones Fix builds (issueScenarioDrafts): the
 * representative failure first, then the variations seen around it, each
 * keeping the issue and the traces it came from so its badge links back.
 */
import { issueScenarioDrafts } from "../errorFeed/issueFix";
import { relativeTime } from "./scenarioProvenance";

const EVIDENCE = { confirmed: "Confirmed", emerging: "Emerging", unresolved: "Unresolved", dismissed: "Dismissed" };

/** One issue, in the shape the picker table reads. */
export const issueAsSource = (issue, env, envState) => {
  const drafts = issueScenarioDrafts(issue, env, envState).map((d) => ({
    ...d,
    batchNote: `Error Feed ${issue.cluster_id}`,
  }));
  const per = Math.max(1, Math.round((issue.trace_count || drafts.length) / Math.max(1, drafts.length)));
  return {
    id: issue.cluster_id,
    title: issue.error?.name || issue.cluster_id,
    type: issue.error?.type || null,
    project: issue.project_id || null,
    severity: issue.severity,
    evidence: EVIDENCE[issue.evidence_state] || null,
    critical: issue.severity === "critical",
    count: issue.trace_count || 0,
    lastSeen: relativeTime(issue.last_seen),
    why: issue.why_shown || null,
    drafts,
    cases: drafts.map((d) => ({
      id: d.id,
      label: d.title,
      quote: d.errorFeedIssue.traceIds.join("  ·  "),
      traceCount: per,
    })),
  };
};
