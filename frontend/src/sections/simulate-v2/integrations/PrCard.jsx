import PropTypes from "prop-types";
import { useSnackbar } from "notistack";
import { Box, Button, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { paths } from "src/routes/paths";
import { useConnectedAgents, useSimStore } from "../store";
import { nextAgentVersion } from "../_mock/versions";
import { draftVersionOf } from "../agents/versionRelease";
import { postSlack, prNoun, resolveApproval, setTracing, updatePr, useIntegrations } from "../_mock/integrations";
import { hasVerifyCheck, headOf, isPending, latestCheck, checkStandingOf, statusOf, useNow } from "../_mock/prChecks";
import { PrStatus } from "./GithubIntegrationPage";
import PrVerifyCheck from "./PrVerifyCheck";

const MONO = "ui-monospace, Menlo, monospace";
const CHANGED = { prompt: "Prompt", code: "Tool code", orchestration: "Orchestration", guardrail: "Guardrail" };

/**
 * Where a fix stands once it has left the product: waiting for approval in
 * Slack → open on GitHub (with our simulation check on it) → merged. Merging
 * is the change actually shipping, so it saves the agent version from that
 * commit and asks for the re-run that proves it. A PR an improvement opened
 * already recorded a Draft version when it opened; merging releases that
 * one rather than minting a second. Otherwise this card mints it — the only
 * place it does. The re-run tests that version; it doesn't mint another.
 *
 * An improvement's PR also carries the required "Future AGI · verify" check:
 * every push re-runs the frozen scenarios on the new head commit and holds it
 * to the proof, and merge stays blocked while that fails.
 *
 * The prototype has no GitHub on the other end, so merge, close and pushes
 * are buttons here; in the product they arrive from the GitHub webhook.
 */
export default function PrCard({ prId, approvalId, env, envState, onRerun, onMerged }) {
  const { prs, approvals } = useIntegrations();
  const { recordAgentVersion } = useConnectedAgents();
  const { dispatch } = useSimStore();
  const { enqueueSnackbar } = useSnackbar();
  const approval = approvalId ? approvals.find((a) => a.id === approvalId) : null;
  const pr = prs.find((p) => p.id === (prId || approval?.prId));
  /* Ticks only while a verify run is queued or running. */
  const verify = hasVerifyCheck(pr);
  const now = useNow(verify && isPending(statusOf(latestCheck(pr), Date.now())));

  if (approval && !pr) {
    if (approval.status === "declined") {
      return (
        <Shell>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Iconify icon="solar:close-circle-linear" width={16} sx={{ color: "#DC2626" }} />
            <Typography sx={{ typography: "s2", fontWeight: 600 }}>{`Declined in ${approval.channel} by ${approval.by}`}</Typography>
          </Stack>
          <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.5 }}>No pull request was opened. The agent is unchanged.</Typography>
        </Shell>
      );
    }
    return (
      <Shell>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Iconify icon="solar:clock-circle-linear" width={16} sx={{ color: "#CA8A04" }} />
          <Box flex={1} minWidth={0}>
            <Typography sx={{ typography: "s2", fontWeight: 600 }}>{`${prNoun(approval.pr)} waiting for approval in ${approval.channel}`}</Typography>
            <Typography sx={{ typography: "s3", color: "text.subtitle" }}>The pull request opens as soon as someone approves it in Slack — or here.</Typography>
          </Box>
          <Button size="small" onClick={() => resolveApproval(approval.id, "declined")} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary" }}>Decline</Button>
          <Button size="small" variant="contained" color="primary" onClick={() => resolveApproval(approval.id, "approved")} sx={{ typography: "s3", fontWeight: 700 }}>Approve</Button>
        </Stack>
      </Shell>
    );
  }
  if (!pr) return null;

  const telemetry = pr.kind === "telemetry";
  const standing = verify ? checkStandingOf(pr, now) : null;
  const merge = () => {
    const mergedAt = new Date().toISOString();
    updatePr(pr.id, { status: "merged", mergedAt });
    /* Tracing changes where the agent reports, not what it does — so it
       turns tracing on and leaves the versions alone. */
    if (telemetry) {
      setTracing(pr.agentKey, { on: true, since: mergedAt, project: pr.project, framework: pr.framework, prNumber: pr.number, repo: pr.repo });
      enqueueSnackbar("Merged — tracing is on. Traces show up in Observe once this deploys.", { variant: "success" });
      postSlack({ event: "pr", title: `Tracing PR merged · ${pr.repo} #${pr.number}`, lines: [`${pr.agentName} now sends traces to Future AGI (project ${pr.project}).`], actions: ["Open in Observe"], links: { "Open in Observe": paths.dashboard.observe } });
      return;
    }
    /* The Draft version recorded when this PR opened — released, not re-minted. */
    const draft = envState?.agent && pr.agentKey ? draftVersionOf(envState, pr.handoffKey) : null;
    if (draft) {
      const landed = {
        status: "released", releasedAt: mergedAt, origin: "pr", prNumber: pr.number,
        note: `Merged PR #${pr.number} — ${pr.title}`,
        changes: pr.files.map((f) => ({
          kind: f.kind === "prompt" ? "instructions" : "tool",
          title: `${CHANGED[f.kind] || "Code"} changed · ${f.path}`,
          detail: f.title,
        })),
      };
      dispatch({ type: "updateAgentVersion", key: pr.agentKey, label: draft.label, patch: landed, activateEnvId: env?.id });
      updatePr(pr.id, { version: draft.label });
      onMerged?.({ ...draft, ...landed });
      enqueueSnackbar(`Merged — Draft ${draft.label} is now released${env ? ", and this environment tests it" : ""}`, { variant: "success" });
    } else if (envState?.agent && pr.agentKey) {
      const version = {
        /* The diff and the run it came from travel with the version, when the
           PR was opened from one. */
        ...nextAgentVersion(envState, {
          note: `Merged PR #${pr.number} — ${pr.title}`,
          applied: pr.applied || [],
          fromRunId: pr.fromRunId || null,
          basedOnVersion: pr.basedOnVersion || null,
        }),
        origin: "pr",
        prNumber: pr.number,
        connectedAt: mergedAt,
        changes: pr.files.map((f) => ({
          kind: f.kind === "prompt" ? "instructions" : "tool",
          title: `${CHANGED[f.kind] || "Code"} changed · ${f.path}`,
          detail: f.title,
        })),
      };
      recordAgentVersion(pr.agentKey, version, env?.id);
      updatePr(pr.id, { version: version.label });
      onMerged?.(version);
      enqueueSnackbar(env ? `Merged — saved as ${version.label}, which this environment now tests` : `Merged — saved as ${version.label}. Environments keep the version they run.`, { variant: "success" });
    }
    postSlack({
      event: "pr", title: `Fix merged · ${pr.repo} #${pr.number}`,
      lines: [pr.title, pr.origin === "error_feed" ? "Error Feed will flag it if the issue comes back." : "Re-run the same scenarios to confirm it in simulation."],
      actions: [pr.origin === "error_feed" ? "Open issue" : "Re-run to verify"],
      links: pr.origin === "error_feed" && pr.clusterId
        ? { "Open issue": paths.dashboard.errorFeed.detail(pr.clusterId) }
        : pr.envId ? { "Re-run to verify": paths.dashboard.simulate.environmentStep(pr.envId, "runs") } : {},
    });
  };

  return (
    <Shell>
      <Stack direction="row" alignItems="center" spacing={1.25}>
        <PrStatus status={pr.status} />
        <Box flex={1} minWidth={0}>
          <Typography noWrap sx={{ typography: "s2", fontWeight: 600 }}>{pr.title}</Typography>
          <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>
            <Box component="span" sx={{ fontFamily: MONO }}>{`${pr.repo} #${pr.number}`}</Box>
            {/* A coding agent's PR comes from its own branch, which we don't name. */}
            {`${pr.branch ? ` · ${pr.branch} → ${pr.base}` : pr.by ? ` · opened by ${pr.by}` : ""}${pr.approvedIn ? ` · approved in ${pr.approvedIn}` : ""}`}
          </Typography>
        </Box>
        <Button
          size="small" variant="outlined"
          onClick={() => enqueueSnackbar("In the product this opens the pull request on GitHub.", { variant: "info" })}
          startIcon={<Iconify icon="mdi:github" width={14} />}
          sx={{ typography: "s3", fontWeight: 700, color: "text.primary", borderColor: "divider" }}
        >
          View on GitHub
        </Button>
      </Stack>

      {/* The check we post on the PR — the evidence where the review happens. */}
      {!pr.check && !telemetry && !verify && pr.status === "open" && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.25, px: 1.25, py: 0.875, borderRadius: 1, bgcolor: (t) => alpha(t.palette.text.primary, 0.04) }}>
          <Iconify icon="solar:clock-circle-linear" width={15} sx={{ color: "text.subtitle" }} />
          <Typography sx={{ typography: "s3", fontWeight: 700 }}>Future AGI simulation</Typography>
          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>Queued — runs the matching scenarios against this branch</Typography>
        </Stack>
      )}
      {pr.check && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.25, px: 1.25, py: 0.875, borderRadius: 1, bgcolor: (t) => alpha(t.palette.text.primary, 0.04) }}>
          <Iconify icon="solar:check-circle-bold" width={15} sx={{ color: "#16A34A" }} />
          <Typography sx={{ typography: "s3", fontWeight: 700 }}>Future AGI simulation</Typography>
          <Typography sx={{ typography: "s3", color: "text.secondary" }}>
            {`${pr.check.scenarios ? `${pr.check.scenarios} scenarios · ` : ""}${pr.check.before}% → ${pr.check.after}% on this branch`}
          </Typography>
        </Stack>
      )}
      {verify && <PrVerifyCheck pr={pr} now={now} />}

      {pr.status === "open" && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.25 }}>
          <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1 }}>
            {standing === "failed"
              ? `The Future AGI check failed on ${headOf(pr)} — a must-pass scenario broke since the PR opened. Push a fix to re-run it; merging is still your call.`
              : standing ? `The Future AGI check is running on ${headOf(pr)}.`
                : telemetry ? "Waiting on review. Set FI_API_KEY and FI_SECRET_KEY where the agent runs before merging." : "Waiting on review. Nothing changes in your agent until it's merged."}
          </Typography>
          <Button size="small" onClick={() => updatePr(pr.id, { status: "closed" })} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary" }}>Close</Button>
          {/* The check is evidence, not a gate — merging is always the team's call. */}
          <Button size="small" variant="outlined" onClick={merge} sx={{ typography: "s3", fontWeight: 700, color: "text.primary", borderColor: "divider" }}>Mark as merged</Button>
        </Stack>
      )}
      {pr.status === "merged" && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.25 }}>
          <Typography sx={{ typography: "s3", color: "text.secondary", flex: 1 }}>
            {telemetry ? "Merged — tracing is on. Traces show up in Observe once this deploys."
              : pr.origin === "error_feed" ? `Merged${pr.version ? ` — saved as agent ${pr.version}` : ""}. Error Feed will flag it if the issue comes back.`
                : pr.version ? `Merged — saved as agent ${pr.version}. Re-run the same scenarios to confirm the fix holds.`
                  : "Merged. Re-run the same scenarios to confirm the fix holds."}
          </Typography>
          {onRerun && !telemetry && (
            <Button size="small" variant="contained" color="primary" onClick={onRerun} startIcon={<Iconify icon="solar:play-bold" width={14} />} sx={{ typography: "s3", fontWeight: 700 }}>
              Re-run to verify
            </Button>
          )}
        </Stack>
      )}
      {pr.status === "closed" && (
        <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 1 }}>{`Closed without merging — ${telemetry ? "tracing wasn't added" : "the fix didn't ship"}. It stays here for the record.`}</Typography>
      )}
    </Shell>
  );
}

PrCard.propTypes = {
  prId: PropTypes.string,
  approvalId: PropTypes.string,
  env: PropTypes.object,
  envState: PropTypes.object,
  onRerun: PropTypes.func,
  onMerged: PropTypes.func,
};

function Shell({ children }) {
  return <Box sx={{ p: 1.75, borderRadius: 1.25, border: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>{children}</Box>;
}
Shell.propTypes = { children: PropTypes.node };
