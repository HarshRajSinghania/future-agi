/*
  Where each version stands on the way to production. A version an
  improvement made is a draft until someone marks it released — the PRD's
  "nothing ships silently". Read from the environments that test the agent:
  which hand-off landed as which version, and what each one released.

  A Draft is recorded the moment a proposal leaves Future AGI — a draft PR
  opened, a platform draft (Vapi copy, Retell draft) made, a Future AGI agent
  or prompt version created, a patch exported — so the agent's history shows
  it straight away. It carries `status: "draft"` and `draftOf` (the
  improvement, how it shipped). When the change lands (the PR merges, the
  platform draft goes live, someone marks it released) that same version is
  the one released; nothing is minted a second time.
*/
import { improvementRunName } from "../_mock/optimizer";
import { agentVersions, nextAgentVersion } from "../_mock/versions";

/** How a draft left Future AGI, as the version history says it. */
export const DRAFT_SOURCE_LABEL = {
  pr: "Draft PR",
  "platform-draft": "Platform draft",
  builtin: "Future AGI version",
  patch: "Patch exported",
  upload: "Patch for your upload",
};

/** The Draft version a proposal recorded, if it recorded one. */
export const draftVersionOf = (envState, optId) => (optId
  ? agentVersions(envState).find((v) => v.draftOf?.optId === optId) || null
  : null);

/**
 * A Draft agent version for a proposal, numbered past every version this
 * environment knows. `source` is one of DRAFT_SOURCE_LABEL's keys.
 */
export const draftVersionRecord = (envState, {
  optId, envId, source, name, issueId, where, prNumber, note, applied = [], fromRunId = null, basedOnVersion = null, at,
}) => ({
  ...nextAgentVersion(envState, {
    note: note || `Draft from ${name || "an improvement"}${where ? ` · ${where}` : ""} — not live until released.`,
    applied,
    fromRunId,
    basedOnVersion,
    now: at,
  }),
  status: "draft",
  origin: source,
  draftOf: {
    optId, envId: envId || null, source, name: name || null,
    ...(issueId && { issueId }),
    ...(where && { where }),
    ...(prNumber != null && { prNumber }),
  },
});

export const versionReleaseOf = (agent, state) => {
  const out = {};
  (agent?.usedIn || []).forEach((u) => {
    const es = state?.byEnv?.[u.envId];
    if (!es) return;
    const current = es.releases?.[0]?.version || null;
    const releasedLabel = (label) => (es.releases || []).some((r) => r.version === label);
    Object.entries(es.handoffLandings || {}).forEach(([key, label]) => {
      const record = (es.optimizations || []).find((o) => o.id === key);
      out[label] = {
        ...out[label],
        from: record ? improvementRunName(es, record) : "Debug failures",
        released: !!out[label]?.released || releasedLabel(label),
      };
    });
    /* Drafts recorded at proposal time — a draft until it's released. */
    agentVersions(es).filter((v) => v.draftOf).forEach((v) => {
      const record = (es.optimizations || []).find((o) => o.id === v.draftOf.optId);
      out[v.label] = {
        ...out[v.label],
        from: out[v.label]?.from || v.draftOf.name || (record ? improvementRunName(es, record) : "Debug failures"),
        via: DRAFT_SOURCE_LABEL[v.draftOf.source] || null,
        released: !!out[v.label]?.released || v.status === "released" || releasedLabel(v.label),
      };
    });
    if (current) out[current] = { ...out[current], released: true, live: true };
  });
  return out;
};
