import PropTypes from "prop-types";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Stack, Typography, Button, Tooltip } from "@mui/material";
import Iconify from "src/components/iconify";
import { connectedAgentPath } from "../improvements/improvementNav";
import { SectionCard } from "../components/primitives";
import OpenPrDialog from "../integrations/OpenPrDialog";
import PrCard from "../integrations/PrCard";
import { prFilesOf, repoNameOf, useIntegrations } from "../_mock/integrations";
import { changeFileFor } from "../_mock/optimize";
import { agentSourceOf, definitionOf, agentIdOf, envAgentKey } from "../_mock/agentRegistry";
import { codingAgentBrief } from "../_mock/codingAgentBrief";
import { releasePatch, rememberedFor, memoryCandidates, rememberPatch, declineMemoryPatch } from "../_mock/releaseFix";
import { PLATFORM_TESTING } from "../_mock/rsiModel";
import { retellPinnedOf, elevenlabsVersioningOn } from "../_mock/improvementPolicy";
import { observabilityOf } from "../_mock/observability";
import { KIND_SURFACE, improvementRunName } from "../_mock/optimizer";
import { linkedRepoOf } from "../agents/agentLimits";
import { draftVersionOf, draftVersionRecord } from "../agents/versionRelease";
import { useOptionalSimStore } from "../store";
import CopyBriefButton from "../components/CopyBriefButton";

/**
 * Handing a change over — never deployed by us, always a draft someone
 * approves. The way is picked by where the agent lives:
 *
 *   repo      → Open draft PR. Merging it saves the next agent version.
 *   draft     → hosted platforms, each its own way (PLATFORM_TESTING):
 *               Vapi — Create a copy to swap in (its API has no drafts);
 *               Retell — Create a draft version, once the live numbers are
 *               pinned to a released version; ElevenLabs and Bland (Phase 2)
 *               — Create a branch (ElevenLabs needs versioning on).
 *   builtin   → built in Future AGI: Create agent version, or Create prompt
 *               version when only the prompt changes.
 *   otherwise → endpoints, pasted prompts, and platforms with no draft
 *               versions (LiveKit, Pipecat): a patch to apply. A
 *               Suggestion-only improvement always ships this way.
 *
 * Copy patch and Hand to my coding agent are always there. The moment a
 * proposal leaves — a draft PR opened, a platform draft made, a Future AGI
 * version created, a patch exported — a Draft agent version is recorded, so
 * the agent's history shows it at once (agents/versionRelease). When the
 * change lands (the PR merges, the draft goes live, it's marked released)
 * that same version is the one released — never a second one. Releasing
 * makes it the baseline and starts the Error Feed's watch. An uploaded-code
 * agent is released by uploading the patched code. Re-run never mints; it
 * tests whatever is current.
 *
 * Phase 1 has no approval step of ours and never deploys on its own: a
 * canary (a share of real calls on the draft) is Phase 3, shown disabled.
 */

/* How long the prototype takes to "detect" a release. */
const DETECT_AFTER_MS = 12000;

/* Platforms that can split traffic between versions — a canary. Canary
   releases are Phase 3 (PRD): shown, tagged and disabled until then. */
const CANARY_PLATFORMS = ["vapi", "retell"];
const CANARY_SHARE = 10;
const CANARY_PHASE = 3;
const CANARY_NOTE = "Sending a share of real calls to the draft is coming soon. Nothing deploys on its own — you publish the draft yourself, then it's detected or you mark it released.";

/* Platforms a candidate can ship to without going live: Vapi and Retell in
   Phase 1, ElevenLabs and Bland branches in Phase 2. */
const DRAFT_PLATFORMS = ["vapi", "retell", "elevenlabs", "bland"];
/* What a shipped draft is called on each platform. */
const DRAFT_KIND = { vapi: "copy", retell: "draft", elevenlabs: "branch", bland: "branch" };

const routeOf = (agent, suggestion) => {
  if (suggestion) return "recommend";
  const def = definitionOf(agent);
  /* A framework agent ships as a PR when its code is in a linked repository. */
  if (def.kind === "repo" || (def.kind === "framework" && def.repoUrl)) return "pr";
  const source = agentSourceOf(agent);
  if (source.kind === "builtin") return "builtin";
  /* A draft needs an assistant to put it on — a platform agent without its
     ID is as far out of reach as an endpoint. */
  return source.kind === "platform" && source.syncable && DRAFT_PLATFORMS.includes(agent?.values?.provider) ? "draft" : "recommend";
};

export default function OmegaHandoff({
  env, envState, patch, included, projected, current, willFix, projectedOn,
  handoffKey, landedVersion, provenance, onLand, onRerun, brief, briefTarget, proof, suggestion = false,
}) {
  const navigate = useNavigate();
  const store = useOptionalSimStore();
  const [prOpen, setPrOpen] = useState(false);
  const [done, setDone] = useState({});
  /* Mark as released lands the change first when it hasn't landed yet, then
     releases the version that landing saved. */
  const [releasing, setReleasing] = useState(false);
  const { prs, approvals } = useIntegrations();

  const agent = envState?.agent;
  const route = routeOf(agent, suggestion);
  const source = agentSourceOf(agent);
  /* Code read once from an uploaded bundle — released by uploading the patched code. */
  const uploaded = source.kind === "upload";
  const provider = agent?.values?.provider;
  const platform = route === "draft" ? PLATFORM_TESTING[provider] || null : null;
  const draftKind = DRAFT_KIND[provider] || "draft";
  /* Retell: a new draft becomes the newest version, so live numbers that
     follow the newest would take real calls on it — pin them first.
     ElevenLabs: branches need versioning on, which only you can switch on. */
  const pin = provider === "retell" ? retellPinnedOf(agent) : null;
  const shipBlock = route !== "draft" ? null
    : provider === "retell" && !pin?.pinned
      ? { title: "Pin your live numbers first", body: PLATFORM_TESTING.retell.note, line: pin?.line }
      : provider === "elevenlabs" && !elevenlabsVersioningOn(agent)
        ? { title: "Switch on versioning first", body: PLATFORM_TESTING.elevenlabs.note }
        : null;
  const openConnections = () => {
    const key = envAgentKey(agent, env?.id);
    if (key) navigate(connectedAgentPath(agentIdOf(key), "connections"));
  };
  const repo = repoNameOf(definitionOf(agent).repoUrl || envState?.agentRepo?.url || "") || null;
  /*
    One mixed change. A single improvement can ship as several parts — a
    platform draft or a Future AGI version for prompts, settings and tools,
    and a draft PR for the code that lives in a linked repository. Each part
    goes out its own way; nothing in any of them is live until released.
  */
  const linkedRepo = route === "pr" ? null : repoNameOf(linkedRepoOf(agent) || envState?.agentRepo?.url || "") || null;
  const deliveryOf = (p) => {
    const surface = KIND_SURFACE[p.kind] || "code";
    if (route === "pr") return "pr";
    if (surface === "code" || surface === "structure") return linkedRepo ? "pr" : "patch";
    return route === "recommend" ? "patch" : route;
  };
  const parts = Object.entries(included.reduce((acc, p) => {
    const d = deliveryOf(p);
    return { ...acc, [d]: [...(acc[d] || []), p] };
  }, {})).map(([delivery, list]) => ({ delivery, list }));
  const mixed = parts.length > 1;
  const codePart = mixed ? parts.find((x) => x.delivery === "pr" || x.delivery === "patch")?.list || [] : [];
  const prFiles = prFilesOf(env, mixed && codePart.length ? codePart : included, changeFileFor);

  /* The PR for this hand-off, if one was opened — found again after the
     drawer was closed, so the card doesn't offer a second one. */
  const pr = handoffKey ? prs.find((p) => p.handoffKey === handoffKey && p.status !== "closed") : null;
  const approval = handoffKey && !pr
    ? approvals.find((a) => a.pr?.handoffKey === handoffKey && a.status === "pending")
    : null;

  /* `patchText`, not `patch` — the prop of that name is the state patcher. */
  const patchOf = (list) => list
    .map((p) => [`# ${p.kind}: ${p.title}`, ...p.diff.map((d) => `${d.type === "add" ? "+" : "-"} ${d.text}`)].join("\n"))
    .join("\n\n");
  const patchText = patchOf(included);
  const summaryLine = included.length === 1
    ? included[0].title
    : `${included.length} changes: ${[...new Set(included.map((c) => c.kind.toLowerCase()))].join(", ")}`;

  const promptOnly = included.every((p) => p.kind === "System prompt");
  const intro = {
    pr: `Opens a draft pull request on ${repo || "the agent's repository"}${included.some((p) => p.kind === "Architecture") ? ", with a written rationale for the structural change" : ""}. Merging it saves the next agent version — nothing changes before that.`,
    draft: platform
      ? `${platform.ships} on ${source.label}. ${platform.note} ${platform.released}`
      : `Creates an unpublished version on ${source.label}. It isn't live until someone publishes it there — then mark it released here.`,
    builtin: `Saves the change as a new ${promptOnly ? "prompt" : "agent"} version here. It isn't live until you mark it released.`,
    recommend: suggestion
      ? "A suggested fix, not a proven one — we can only call this agent, so you apply it. Once it's live, mark the new version released, then re-run on the same environment version to prove it."
      : source.kind === "platform"
      ? `${source.label} doesn't support draft versions yet, so the change goes out as a patch. Apply it in ${source.label}, then mark it released here.`
      : uploaded
        ? "Apply this patch to your upload, then upload it again to release it."
        : `We don't hold this agent (${source.label.toLowerCase()}), so the change goes out as a patch. Once it's deployed, mark it released here.`,
  }[route];

  /*
    The Draft version — recorded when the proposal leaves, found again by
    the improvement it came from. Landing reuses it; releasing marks it.
  */
  const agentKey = envAgentKey(agent, env?.id);
  const draftVersion = draftVersionOf(envState, handoffKey);
  const recordDraft = (draftSource, { where, prNumber } = {}) => {
    if (!handoffKey || !agentKey || !store || draftVersionOf(envState, handoffKey) || landedVersion) return;
    const record = (envState?.optimizations || []).find((o) => o.id === handoffKey);
    const version = draftVersionRecord(envState, {
      optId: handoffKey, envId: env?.id, source: draftSource,
      name: record ? improvementRunName(envState, record) : "Debug failures",
      issueId: record?.trigger?.issueId, where, prNumber, applied: included,
      fromRunId: provenance?.fromRunId || record?.fromRunId || null,
      basedOnVersion: provenance?.basedOnVersion || record?.baseAgentVersion || null,
    });
    /* The agent's, not this environment's — none of them switches to it. */
    store.dispatch({ type: "recordAgentVersion", key: agentKey, version });
  };
  const setVersionState = (label, vPatch, activate = false) => {
    if (!store || !agentKey || !label) return;
    store.dispatch({ type: "updateAgentVersion", key: agentKey, label, patch: vPatch, ...(activate && env?.id && { activateEnvId: env.id }) });
  };
  /* Land with the Draft version, once it exists — never a fresh one. */
  const [landing, setLanding] = useState(null);
  useEffect(() => {
    if (!landing || !draftVersion || landedVersion) return;
    const info = landing;
    setLanding(null);
    setVersionState(draftVersion.label, { landedAt: new Date().toISOString(), ...(info.uploadedFile && { uploadedFile: info.uploadedFile }) }, true);
    onLand?.({ ...info, version: { ...draftVersion, ...(info.note && { note: info.note }) } });
  }, [landing, draftVersion, landedVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const landWithDraft = (info, draftSource, extra) => {
    /* Nowhere to record a draft (no improvement to name it after): land as before. */
    if (!handoffKey || !agentKey || !store) { onLand?.(info); return; }
    if (!draftVersion) recordDraft(draftSource, extra);
    setLanding(info);
  };
  /* A draft PR opened (here, or after a Slack approval) is a proposal leaving. */
  useEffect(() => {
    if (route === "pr" && pr && !draftVersion && !landedVersion) recordDraft("pr", { prNumber: pr.number, where: `PR #${pr.number}` });
  }, [route, pr?.id, draftVersion, landedVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = () => {
    navigator.clipboard?.writeText(patchText).catch(() => {});
    setDone((d) => ({ ...d, copied: true }));
    /* For an agent we only send patches to, copying the patch is the hand-off. */
    if (route === "recommend") recordDraft(uploaded ? "upload" : "patch", { where: uploaded ? "patch for your upload" : "patch" });
  };
  /* Uploaded code: the release is the patched bundle, uploaded again. */
  const uploadInput = useRef(null);
  const onUploadPatched = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    markReleased({ origin: "upload", note: `Patched code uploaded (${file.name}) — ${summaryLine}`, uploadedFile: file.name }, { draftSource: "upload" });
  };

  const draft = handoffKey ? envState?.handoffDrafts?.[handoffKey] : null;
  const released = !!landedVersion && (envState?.releases || []).some((r) => r.version === landedVersion);
  /* Releasing makes it the baseline, starts the Error Feed's watch, and —
     for a fix — keeps the issue's scenarios as must-pass. */
  const release = (version, { detected = false } = {}) => {
    patch?.(releasePatch(envState, { version, optId: handoffKey, detected }).patch);
    setVersionState(version, { status: "released", releasedAt: new Date().toISOString() });
  };
  useEffect(() => {
    if (releasing && landedVersion) {
      setReleasing(false);
      if (!released) release(landedVersion, { detected: releasing === "detected" });
    }
  }, [releasing, landedVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const markReleased = (land, { detected = false, draftSource } = {}) => {
    if (landedVersion) { release(landedVersion, { detected }); return; }
    setReleasing(detected ? "detected" : true);
    /* A merged PR arrives with its version; anything else lands on the Draft. */
    if (land?.version) { onLand?.(land); return; }
    landWithDraft(land, draftSource || (route === "draft" ? "platform-draft" : route === "builtin" ? "builtin" : uploaded ? "upload" : "patch"), { where: route === "draft" ? `${source.label} ${draftKind}` : undefined });
  };

  /*
    Release detection. A draft published on the platform shows up through
    its API; a merged PR shows up in production traces once it's deployed.
    Either way the release is recorded on its own — Mark as released is the
    fallback for anything we can't see. (The prototype detects it a few
    seconds after the draft or merge.)
  */
  const traced = observabilityOf(agent).on;
  /* A canary: the draft takes a small share of real calls, measured against
     the rest. A person promotes it or rolls it back — never automatic. */
  /* Phase 3: a canary saved before it was tagged is read as a plain draft. */
  const canary = CANARY_PHASE <= 1 && handoffKey ? envState?.handoffCanary?.[handoffKey] : null;
  const canCanary = route === "draft" && CANARY_PLATFORMS.includes(agent?.values?.provider);
  const setCanary = (value) => {
    const { [handoffKey]: _drop, ...rest } = envState?.handoffCanary || {};
    patch?.({ handoffCanary: value ? { ...rest, [handoffKey]: value } : rest });
  };
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!canary || landedVersion) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(t);
  }, [canary, landedVersion]);
  /* Detection is timed from when the draft was made: one made in this
     session is "published" a few seconds later; an older draft (a scheduled
     run's, say) stays a draft until someone publishes or releases it. */
  const draftAge = draft ? Date.now() - Date.parse(draft.at) : Infinity;
  const awaitingDraft = route === "draft" && !!draft && !landedVersion && !canary && draftAge < DETECT_AFTER_MS * 5;
  const awaitingDeploy = route === "pr" && !!landedVersion && !released && traced;
  useEffect(() => {
    if (!awaitingDraft && !awaitingDeploy) return undefined;
    const t = setTimeout(() => {
      if (awaitingDraft) markReleased({ origin: "platform", note: `Published on ${source.label} — ${summaryLine}` }, { detected: true });
      else release(landedVersion, { detected: true });
    }, awaitingDraft ? Math.max(0, DETECT_AFTER_MS - draftAge) : DETECT_AFTER_MS);
    return () => clearTimeout(t);
  }, [awaitingDraft, awaitingDeploy]); // eslint-disable-line react-hooks/exhaustive-deps
  const releaseEntry = released ? (envState?.releases || []).find((r) => r.version === landedVersion) : null;
  const remembered = rememberedFor(envState, handoffKey);
  /* Regression memory needs the user's approval: only scenarios that passed
     every repeat are offered; ones still failing sometimes stay targets. */
  const memory = released ? memoryCandidates(envState, handoffKey) : { mustPass: [], targets: [] };
  const askMemory = !suggestion && memory.mustPass.length > 0 && !envState?.memoryDecisions?.[handoffKey];

  /* The same change as a brief a coding agent can work from; the caller can
     pass a fuller one (the issue, the evidence, the constraints). */
  const codingAgent = (
    <CopyBriefButton
      label="Hand to my coding agent"
      target={briefTarget}
      getBrief={brief || (() => codingAgentBrief({ agent, env, issue: summaryLine, suggestedFix: included }))}
      /* Every kind of agent: the brief says what to submit — a commit, a
         settings patch, a draft version (candidateRoute). */
    />
  );

  if (!included.length) {
    return (
      <SectionCard>
        <Typography sx={{ typography: "s2", color: "text.subtitle", px: 2.5, py: 2 }}>
          Include a change below to see what it would do.
        </Typography>
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <Stack spacing={1.5} sx={{ px: 2.5, py: 2 }}>
        {/* How it will ship is said before it ships; once it has landed the
            section above says where it is, so only the re-run bar stays. */}
        <Typography sx={{ typography: "s2", color: "text.secondary" }}>
          {!landedVersion && intro}
          {/* The projection, said here so the number checked later is one the
              reader saw before handing anything over. */}
          {projected != null && `${landedVersion ? "" : " "}The re-run after it lands is held against ${projected}%${projectedOn ? ` (${projectedOn === "held out" ? "held-back scenarios" : projectedOn})` : ""}.`}
        </Typography>

        {/* ── a mixed change: each part and how it ships ── */}
        {mixed && (
          <ShipParts
            parts={parts} sourceLabel={source.label} repo={linkedRepo}
            pr={pr} onOpenPr={() => setPrOpen(true)}
            onCopyPart={(list) => { navigator.clipboard?.writeText(list.map((p) => [`# ${p.kind}: ${p.title}`, ...p.diff.map((d) => `${d.type === "add" ? "+" : "-"} ${d.text}`)].join("\n")).join("\n\n")).catch(() => {}); }}
          />
        )}

        {/* ── repo: the PR is the hand-off, and its card carries the merge ── */}
        {route === "pr" && (pr || approval) && (
          <PrCard
            prId={pr?.id} approvalId={approval?.id} env={env} envState={envState}
            onRerun={onRerun}
            /* Merging is the user releasing it: the Draft version lands and is released. */
            onMerged={(version) => markReleased({ version })}
          />
        )}
        {route === "pr" && !pr && !approval && (
          <Box>
            <Button
              size="small" variant="contained" color="primary"
              onClick={() => setPrOpen(true)}
              startIcon={<Iconify icon="mdi:github" width={15} />}
              sx={{ typography: "s2", fontWeight: 700 }}
            >
              Open draft PR
            </Button>
          </Box>
        )}

        {/* ── Vapi / Retell: an unpublished version on the platform ── */}
        {route === "draft" && !landedVersion && (
          draft && canary ? (
            <CanaryPanel
              canary={canary} where={draft.where} candidate={projected} control={current}
              onPromote={() => { setCanary(null); markReleased({ origin: "platform", note: `Promoted from a ${canary.share}% canary on ${source.label} — ${summaryLine}` }); }}
              onRollBack={() => setCanary(null)}
            />
          ) : draft ? (
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Iconify icon="solar:check-circle-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0 }} />
              <Typography sx={{ typography: "s2", color: "text.secondary", flex: 1 }}>
                {draftKind === "copy"
                  ? `Copy created on ${draft.where} — not live yet. Swap it in for the live assistant when you're ready; ${platform?.released ? platform.released.charAt(0).toLowerCase() + platform.released.slice(1) : "then mark it released."}`
                  : `${draftKind === "branch" ? "Branch" : "Draft version"} created on ${draft.where} — not live yet. ${platform?.released || "When it's published there we'll detect it and start watching; or mark it released yourself."}`}
              </Typography>
              {canCanary && (
                <Tooltip arrow title={CANARY_NOTE}>
                  <span>
                    <Button
                      size="small" variant="outlined" disabled
                      onClick={() => setCanary({ share: CANARY_SHARE, startedAt: new Date().toISOString() })}
                      endIcon={(
                        <Box component="span" sx={{ typography: "s3", fontWeight: 700, px: 0.5, borderRadius: 0.5, border: "1px solid", borderColor: "divider", lineHeight: 1.4 }}>
                          Coming soon
                        </Box>
                      )}
                      sx={{ typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider", flexShrink: 0 }}
                    >
                      {`Canary to ${CANARY_SHARE}% of calls`}
                    </Button>
                  </span>
                </Tooltip>
              )}
              <Button
                size="small" variant="contained" color="primary"
                onClick={() => markReleased({ origin: "platform", note: `Published on ${source.label} — ${summaryLine}` })}
                startIcon={<Iconify icon="solar:check-read-linear" width={15} />}
                sx={{ typography: "s2", fontWeight: 700, flexShrink: 0 }}
              >
                Mark as released
              </Button>
            </Stack>
          ) : shipBlock ? (
            <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, px: 1.5, py: 1.25 }}>
              <Stack direction="row" spacing={1.25} alignItems="flex-start">
                <Iconify icon="solar:lock-keyhole-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0, mt: "2px" }} />
                <Box flex={1} minWidth={0}>
                  <Typography sx={{ typography: "s2", fontWeight: 600 }}>{shipBlock.title}</Typography>
                  <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>{shipBlock.body}</Typography>
                  {shipBlock.line && <Typography sx={{ typography: "s3", color: "text.secondary", mt: 0.5 }}>{shipBlock.line}</Typography>}
                </Box>
                <Button
                  size="small" variant="outlined" onClick={openConnections}
                  sx={{ typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider", flexShrink: 0 }}
                >
                  Open Connections
                </Button>
              </Stack>
              <Button
                size="small" variant="contained" color="primary" disabled
                startIcon={<Iconify icon="solar:upload-minimalistic-linear" width={15} />}
                sx={{ typography: "s2", fontWeight: 700, mt: 1.25 }}
              >
                {platform?.shipAction || "Create a draft version"}
              </Button>
            </Box>
          ) : (
            <Box>
              <Button
                size="small" variant="contained" color="primary"
                onClick={() => {
                  patch?.({ handoffDrafts: { ...(envState?.handoffDrafts || {}), [handoffKey]: { where: source.label, kind: draftKind, at: new Date().toISOString() } } });
                  /* The platform draft is the proposal leaving — a Draft version now. */
                  recordDraft("platform-draft", { where: `${source.label} ${draftKind}` });
                }}
                startIcon={<Iconify icon={draftKind === "copy" ? "solar:copy-linear" : "solar:upload-minimalistic-linear"} width={15} />}
                sx={{ typography: "s2", fontWeight: 700 }}
              >
                {platform?.shipAction || "Create a draft version"}
              </Button>
              {platform && (
                <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.75 }}>{`Tested as: ${platform.tests.charAt(0).toLowerCase()}${platform.tests.slice(1)}.`}</Typography>
              )}
            </Box>
          )
        )}

        {/* ── built in Future AGI: a new version here, not live until released ── */}
        {route === "builtin" && !landedVersion && (
          <Box>
            <Button
              size="small" variant="contained" color="primary"
              onClick={() => landWithDraft({ origin: "builtin", note: summaryLine }, "builtin", { where: promptOnly ? "prompt version" : "agent version" })}
              startIcon={<Iconify icon="solar:layers-minimalistic-linear" width={15} />}
              sx={{ typography: "s2", fontWeight: 700 }}
            >
              {promptOnly ? "Create prompt version" : "Create agent version"}
            </Button>
          </Box>
        )}

        {/* ── endpoint, pasted prompt, or a platform without drafts: a patch ── */}
        {route === "recommend" && !landedVersion && (
          uploaded ? (
            <Box>
              <input ref={uploadInput} type="file" accept=".zip,.tar,.gz,.tgz" hidden onChange={onUploadPatched} />
              <Button
                size="small" variant="contained" color="primary"
                onClick={() => uploadInput.current?.click()}
                startIcon={<Iconify icon="solar:upload-minimalistic-linear" width={15} />}
                sx={{ typography: "s2", fontWeight: 700 }}
              >
                Upload the patched code
              </Button>
              <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.75 }}>
                {draftVersion ? `Draft ${draftVersion.label} is waiting on it — uploading releases it.` : "Copy the patch, apply it to your code, then upload the bundle here."}
              </Typography>
            </Box>
          ) : (
            <Box>
              <Button
                size="small" variant="contained" color="primary"
                onClick={() => markReleased({ origin: "deployed", note: `Deployed outside Future AGI — ${summaryLine}` })}
                startIcon={<Iconify icon="solar:check-read-linear" width={15} />}
                sx={{ typography: "s2", fontWeight: 700 }}
              >
                Mark as released
              </Button>
            </Box>
          )
        )}

        {/* The Draft version this proposal recorded — named, not live. */}
        {draftVersion && !landedVersion && (
          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
            {`Recorded as Draft agent ${draftVersion.label}${draftVersion.draftOf?.where ? ` · ${draftVersion.draftOf.where}` : ""} — it becomes Released when ${route === "pr" ? "the PR merges" : route === "draft" ? "it goes live on the platform" : uploaded ? "you upload the patched code" : "you mark it released"}.`}
          </Typography>
        )}

        {/* ── landed: the version exists, so re-run tests it; released starts the watch ── */}
        {landedVersion && (
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Iconify icon="solar:check-circle-bold" width={16} sx={{ color: "text.secondary", flexShrink: 0 }} />
            <Typography sx={{ typography: "s2", color: "text.secondary", flex: 1 }}>
              {released
                ? `${releaseEntry?.detected ? "Release detected" : "Released"} as agent ${landedVersion} — the new baseline${remembered.length ? `. ${remembered.length} of ${remembered[0].regressionMemory.issueId}'s scenarios are now must-pass, so it can't quietly come back` : ""}.`
                : awaitingDeploy
                  ? `Merged as agent ${landedVersion}. We'll see it in production traces once it's deployed; or mark it released yourself.`
                  : `Saved as agent ${landedVersion}, not released yet. Mark it released once it's live.`}
            </Typography>
            {!released && (
              <Button
                size="small" variant="outlined" onClick={() => release(landedVersion)}
                sx={{ typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider", flexShrink: 0 }}
              >
                Mark as released
              </Button>
            )}
            <Button
              size="small" variant={released ? "contained" : "text"} color="primary" onClick={onRerun}
              startIcon={<Iconify icon="solar:play-bold" width={14} />}
              sx={{ typography: "s2", fontWeight: 700, flexShrink: 0 }}
            >
              {suggestion && released ? "Re-run on the same environment version to prove it" : `Re-run ${landedVersion}`}
            </Button>
          </Stack>
        )}

        {/* ── regression memory declined: still reversible ── */}
        {released && !suggestion && memory.mustPass.length > 0 && envState?.memoryDecisions?.[handoffKey]?.decision === "declined" && (
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 0.25 }}>
            <Iconify icon="solar:shield-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0 }} />
            <Typography sx={{ typography: "s3", color: "text.secondary", flex: 1, minWidth: 0 }}>
              {`Not kept as must-pass — ${memory.mustPass.length} ${memory.mustPass.length === 1 ? "scenario" : "scenarios"} from this fix could still guard against it coming back.`}
            </Typography>
            <Button
              size="small" variant="outlined"
              onClick={() => patch?.(rememberPatch(envState, { optId: handoffKey, ids: memory.mustPass.map((x) => x.id), version: landedVersion }))}
              sx={{ typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider", flexShrink: 0 }}
            >
              Keep as must-pass
            </Button>
          </Stack>
        )}

        {/* ── regression memory, asked once the fix is released ── */}
        {released && askMemory && (
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, px: 1.5, py: 1.25 }}>
            <Iconify icon="solar:shield-check-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0 }} />
            <Box flex={1} minWidth={0}>
              <Typography sx={{ typography: "s2", fontWeight: 600 }}>
                {`Keep ${memory.mustPass.length} ${memory.mustPass.length === 1 ? "scenario that passes" : "scenarios that pass"} every repeat on the released version as must-pass?`}
              </Typography>
              <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>
                {`From a confirmation run of the fix's targets on ${memory.confirmation?.version || landedVersion}, ${memory.confirmation?.of || 3} repeats each. Regression memory: a later change that fails one again is rejected, so the issue can't quietly come back.${memory.targets.length ? ` ${memory.targets.length} still ${memory.targets.length === 1 ? "fails" : "fail"} sometimes and ${memory.targets.length === 1 ? "stays a target" : "stay targets"}.` : ""}`}
              </Typography>
            </Box>
            <Button size="small" onClick={() => patch?.(declineMemoryPatch(envState, handoffKey))} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary", flexShrink: 0 }}>
              Not now
            </Button>
            <Button
              size="small" variant="outlined"
              onClick={() => patch?.(rememberPatch(envState, { optId: handoffKey, ids: memory.mustPass.map((x) => x.id), version: landedVersion }))}
              sx={{ typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider", flexShrink: 0 }}
            >
              Keep as must-pass
            </Button>
          </Stack>
        )}

        {/* ── always: the change as a patch, or as a brief for a coding agent ── */}
        <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1} sx={{ pt: 0.5 }}>
          <Button
            size="small" variant="outlined" onClick={copy}
            startIcon={<Iconify icon={done.copied ? "solar:check-circle-bold" : "solar:copy-linear"} width={15} />}
            sx={{ typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider" }}
          >
            {done.copied ? "Patch copied" : "Copy patch"}
          </Button>
          {codingAgent}
        </Stack>
      </Stack>

      {(route === "pr" || (mixed && linkedRepo)) && (
        <OpenPrDialog
          open={prOpen}
          onClose={() => setPrOpen(false)}
          env={env} envState={envState} patch={patch}
          files={prFiles}
          summary={{ fixes: willFix, before: current, after: projected, scenarios: envState?.scenarios?.length, headline: included[0]?.title }}
          meta={{ handoffKey, applied: included, ...(provenance || {}) }}
          proof={proof || undefined}
          patchText={patchOf(mixed && codePart.length ? codePart : included)}
        />
      )}
    </SectionCard>
  );
}

OmegaHandoff.propTypes = {
  env: PropTypes.object,
  envState: PropTypes.object,
  patch: PropTypes.func,
  included: PropTypes.array,
  projected: PropTypes.number,
  current: PropTypes.number,
  willFix: PropTypes.number,
  projectedOn: PropTypes.string,
  handoffKey: PropTypes.string,
  landedVersion: PropTypes.string,
  provenance: PropTypes.object,
  onLand: PropTypes.func,
  onRerun: PropTypes.func,
  brief: PropTypes.func,
  briefTarget: PropTypes.object,
  proof: PropTypes.string,
  suggestion: PropTypes.bool,
};

/*
  A canary in flight: the draft answers a small share of real calls and is
  measured against the rest, on the same evaluations. The harness only reads
  it (PRD v7: it never promotes or ships) — promoting or rolling back happens
  in the provider; these buttons record what the person did there.
*/
function CanaryPanel({ canary, where, candidate, control, onPromote, onRollBack }) {
  const seconds = Math.max(0, (Date.now() - Date.parse(canary.startedAt)) / 1000);
  /* The prototype's calls arrive fast so the panel fills while you watch. */
  const calls = Math.min(600, Math.round(seconds * 6));
  const enough = calls >= 120;
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
        <Iconify icon="solar:pie-chart-2-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0 }} />
        <Typography sx={{ typography: "s2", fontWeight: 600, flex: 1 }}>
          {`Canary · ${canary.share}% of calls on ${where}`}
        </Typography>
        <Typography sx={{ typography: "s3", color: "text.subtitle", fontVariantNumeric: "tabular-nums" }}>
          {`${calls} calls so far`}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={4} sx={{ px: 1.5, py: 1.25 }}>
        <Box>
          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>Canary</Typography>
          <Typography sx={{ typography: "m3", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{enough && candidate != null ? `${candidate}%` : "—"}</Typography>
        </Box>
        <Box>
          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>Everyone else</Typography>
          <Typography sx={{ typography: "m3", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{enough && control != null ? `${control}%` : "—"}</Typography>
        </Box>
        <Box flex={1}>
          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>Reading</Typography>
          <Typography sx={{ typography: "s2", color: "text.secondary", mt: 0.25 }}>
            {enough
              ? "Task success on real calls, same evaluations as the simulation. No must-pass failures on the canary."
              : "Too few calls to compare yet — the numbers show at 120."}
          </Typography>
        </Box>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.5, pb: 1.25 }}>
        <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1 }}>
          {`Promote or roll back in ${where} — that's your call. Tell us which, so results and regressions are read against what's live.`}
        </Typography>
        <Button size="small" onClick={onRollBack} sx={{ typography: "s2", fontWeight: 700, color: "text.secondary", flexShrink: 0 }}>
          I rolled it back
        </Button>
        <Button size="small" variant="outlined" onClick={onPromote} sx={{ typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider", flexShrink: 0 }}>
          {`I promoted it in ${where}`}
        </Button>
      </Stack>
    </Box>
  );
}
CanaryPanel.propTypes = {
  canary: PropTypes.object, where: PropTypes.string, candidate: PropTypes.number, control: PropTypes.number,
  onPromote: PropTypes.func, onRollBack: PropTypes.func,
};

const PART_LABEL = {
  pr: (repo) => `Draft PR${repo ? ` on ${repo}` : ""}`,
  draft: (_, where) => `Draft version on ${where}`,
  builtin: () => "New Future AGI version",
  patch: () => "Patch to apply",
};
const KINDS = (list) => [...new Set(list.map((p) => (p.kind === "Agent setting" ? "settings" : p.kind.toLowerCase())))].join(", ");

/* The parts of a mixed change, each with how it ships. */
function ShipParts({ parts, sourceLabel, repo, pr, onOpenPr, onCopyPart }) {
  const [copied, setCopied] = useState(null);
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
      <Typography sx={{ px: 1.5, py: 0.875, typography: "s3", fontWeight: 700, color: "text.subtitle", textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid", borderColor: "divider" }}>
        {`Ships in ${parts.length} parts`}
      </Typography>
      {parts.map(({ delivery, list }, i) => (
        <Stack key={delivery} direction="row" alignItems="center" spacing={1.5} sx={{ px: 1.5, py: 1, borderTop: i ? "1px solid" : "none", borderColor: "divider" }}>
          <Box flex={1} minWidth={0}>
            <Typography sx={{ typography: "s2", fontWeight: 600 }}>{(PART_LABEL[delivery] || PART_LABEL.patch)(repo, sourceLabel)}</Typography>
            <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>{`${KINDS(list)} · ${list.map((p) => p.title).join(" · ")}`}</Typography>
          </Box>
          {delivery === "pr" && (pr
            ? <Typography sx={{ typography: "s3", color: "text.secondary", flexShrink: 0 }}>{`PR #${pr.number} open`}</Typography>
            : (
              <Button size="small" variant="outlined" onClick={onOpenPr} startIcon={<Iconify icon="mdi:github" width={14} />} sx={{ typography: "s3", fontWeight: 700, color: "text.primary", borderColor: "divider", flexShrink: 0 }}>
                Open draft PR
              </Button>
            ))}
          {delivery === "patch" && (
            <Button size="small" variant="outlined" onClick={() => { onCopyPart(list); setCopied(delivery); }} sx={{ typography: "s3", fontWeight: 700, color: "text.primary", borderColor: "divider", flexShrink: 0 }}>
              {copied === delivery ? "Copied" : "Copy this part"}
            </Button>
          )}
          {(delivery === "draft" || delivery === "builtin") && (
            <Typography sx={{ typography: "s3", color: "text.subtitle", flexShrink: 0 }}>below</Typography>
          )}
        </Stack>
      ))}
    </Box>
  );
}
ShipParts.propTypes = {
  parts: PropTypes.array, sourceLabel: PropTypes.string, repo: PropTypes.string, pr: PropTypes.object,
  onOpenPr: PropTypes.func, onCopyPart: PropTypes.func,
};
