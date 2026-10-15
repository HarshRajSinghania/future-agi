import PropTypes from "prop-types";
import { useMemo, useState } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { definitionOf } from "../_mock/agentRegistry";
import { installedRepos, repoNameOf, telemetryDraft, useIntegrations } from "../_mock/integrations";
import OpenPrDialog from "../integrations/OpenPrDialog";
import PrCard from "../integrations/PrCard";
import { MONO, ago } from "./agentViewUtils";

/**
 * "Do you want traceAI?" — for an agent whose code we can open a pull
 * request on. Simulation finds what could go wrong; traces show what does
 * go wrong in production, and Error Feed needs them. One PR adds the
 * instrumentor for the framework we detected, and merging turns it on.
 */
export default function AgentTracingCard({ agent }) {
  const integrations = useIntegrations();
  const { prs, approvals, tracing } = integrations;
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  const def = definitionOf(agent);
  const repo = repoNameOf(def.repoUrl);
  const onGithub = def.kind === "repo" && installedRepos(integrations).some((r) => r.name === repo);
  const draft = useMemo(() => (onGithub ? telemetryDraft({ agent, repo }) : null), [agent, repo, onGithub]);

  if (!onGithub) return null;
  const on = tracing?.[agent.key];
  if (on?.on) {
    return (
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2, px: 1.5, py: 1, borderRadius: 1.25, border: "1px solid", borderColor: "divider" }}>
        <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "#16A34A", flexShrink: 0 }} />
        <Typography sx={{ typography: "s2", fontWeight: 600 }}>Tracing on</Typography>
        <Typography noWrap sx={{ typography: "s3", color: "text.subtitle", flex: 1, minWidth: 0 }}>
          {"traceAI · project "}
          <Box component="span" sx={{ fontFamily: MONO }}>{on.project}</Box>
          {` · added by PR #${on.prNumber} ${ago(on.since)}`}
        </Typography>
      </Stack>
    );
  }

  /* A tracing PR already on its way — show where it stands instead of offering another. */
  const approval = approvals.find((a) => a.pr?.kind === "telemetry" && a.pr.agentKey === agent.key && a.status === "pending");
  const pr = prs.find((p) => p.kind === "telemetry" && p.agentKey === agent.key && p.status === "open");
  if (approval || pr) {
    return <Box sx={{ mb: 2 }}><PrCard approvalId={approval?.id} prId={pr?.id} /></Box>;
  }
  if (hidden) return null;

  return (
    <Box sx={{ mb: 2, p: 1.75, borderRadius: 1.5, border: "1px solid", borderColor: "divider", bgcolor: (t) => alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.03 : 0.015) }}>
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Box sx={{ width: 32, height: 32, borderRadius: 1, display: "grid", placeItems: "center", flexShrink: 0, border: "1px solid", borderColor: "divider", bgcolor: "background.paper", color: "text.secondary" }}>
          <Iconify icon="solar:pulse-2-linear" width={17} />
        </Box>
        <Box flex={1} minWidth={0}>
          <Typography sx={{ typography: "s2", fontWeight: 700 }}>No production traces from this agent yet</Typography>
          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
            {`Add traceAI in one pull request — we detected ${draft.framework}, so it's ${draft.files.length} small changes. Error Feed then finds failures in real conversations.`}
          </Typography>
        </Box>
        <Button size="small" onClick={() => setHidden(true)} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary" }}>Not now</Button>
        <Button
          size="small" variant="outlined" onClick={() => setOpen(true)}
          startIcon={<Iconify icon="mdi:github" width={14} />}
          sx={{ typography: "s3", fontWeight: 700, color: "text.primary", borderColor: "divider", whiteSpace: "nowrap" }}
        >
          Add tracing
        </Button>
      </Stack>

      <OpenPrDialog
        open={open} onClose={() => setOpen(false)}
        agent={agent} files={draft.files} draft={draft} kind="telemetry"
        heading="Add tracing with traceAI"
        subheading="Instruments the agent so its production traces reach Future AGI. It doesn't change what the agent does."
      />
    </Box>
  );
}

AgentTracingCard.propTypes = { agent: PropTypes.object.isRequired };
