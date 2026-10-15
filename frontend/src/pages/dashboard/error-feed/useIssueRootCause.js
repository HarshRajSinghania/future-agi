import { useMemo } from "react";
import { useErrorFeedStore } from "./store";
import { MESSAGE_TYPE } from "./constants";

/**
 * The issue's root cause, the one Fix and Copy for coding agent both carry
 * (RSI PRD: the issue snapshot holds the root cause; Diagnose reuses the
 * Error Feed root cause). Newest first:
 *   1. the Root cause tab's latest finding (Find root cause),
 *   2. the cluster's cached analysis,
 *   3. the feed's own one-line reading — a first read, not a diagnosis.
 * Returns { headline, fix, source: "analysis" | "feed" } or null.
 */
export const rootCauseOf = (issue, thread) => {
  const finding = [...(thread?.messages || [])].reverse()
    .find((m) => m.type === MESSAGE_TYPE.SYNTHESIS && m.category !== "error" && m.headline);
  if (finding) return { headline: finding.headline, fix: finding.fix || null, source: "analysis" };
  if (issue?.rca?.synthesis) return { headline: issue.rca.synthesis, fix: issue.rca.fix || null, source: "analysis" };
  if (issue?.why_shown) return { headline: issue.why_shown, fix: null, source: "feed" };
  return null;
};

export default function useIssueRootCause(issue) {
  const thread = useErrorFeedStore((s) => s.analyzeThreadsByCluster[issue?.cluster_id]);
  return useMemo(() => rootCauseOf(issue, thread), [issue, thread]);
}
