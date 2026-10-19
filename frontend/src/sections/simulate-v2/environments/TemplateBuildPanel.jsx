import PropTypes from "prop-types";
import { useMemo, useState } from "react";
import { alpha } from "@mui/material/styles";
import {
  Box, Stack, Typography, Button,
} from "@mui/material";
import Iconify from "src/components/iconify";
import { getSurface } from "../_mock/surfaces";
import { useConnectedAgents } from "../store";
import { SectionCard } from "../components/primitives";
import BuildEnvironmentDialog from "../agents/BuildEnvironmentDialog";
import { HintLine } from "../agents/connect/replicationBits";
import WorldAgentPicker from "./AgentChoice";
import { buildableAgentsOf, templateWorldSource, useBuildForAgent } from "./worldSource";

/**
 * A prebuilt world, as the world source of one agent's environment.
 *
 * Every environment belongs to exactly one agent in Agents (RSI PRD), so a
 * prebuilt world is never built on its own or with a stand-in: the user picks
 * one of their agents (or connects one here), then the same Build environment
 * dialog the agent page uses (name, version, 10–1,000 scenarios) opens, and
 * the builder builds that agent's environment starting from this world's
 * tables, tools and rules — reading the agent, checking its tools against
 * the world, proving the scenarios, then running the suite once.
 *
 * Rendered in the world drawer, so it takes a base `template`.
 */
export default function TemplateBuildPanel({ template, showName = false }) {
  const { agents: all } = useConnectedAgents();
  const agents = useMemo(() => buildableAgentsOf(all), [all]);
  const [agentId, setAgentId] = useState(null);
  const agent = agents.find((a) => a.id === agentId) || null;
  const [dialogOpen, setDialogOpen] = useState(false);
  const build = useBuildForAgent();

  if (!template) return null;
  const env = template;
  const surface = getSurface(env.surface);
  const rows = (env.seed?.tables || []).reduce((a, t) => a + t.rows, 0);

  return (
    <Stack spacing={2}>
      {showName && (
        <Box>
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <Iconify icon={surface.icon} width={13} sx={{ color: "text.subtitle" }} />
            <Typography sx={{ typography: "s3", color: "text.subtitle", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>
              {env.surface}
            </Typography>
          </Stack>
          <Typography sx={{ typography: "m2", fontWeight: 700, mt: 0.5 }}>{env.name}</Typography>
          <Typography sx={{ typography: "s2", color: "text.secondary", mt: 0.25 }}>{env.tagline}</Typography>
        </Box>
      )}

      <SectionCard
        title="Build an agent's environment from this world"
        subtitle="The world is the starting point; the agent is what's tested."
      >
        <Stack sx={{ p: 2.5 }} spacing={2}>
          <WorldAgentPicker value={agentId} onChange={setAgentId} />
          <Stack spacing={1.25}>
            {[
              { icon: "solar:box-minimalistic-linear", text: "Seeded with this world's tables, tools and hard rules." },
              { icon: "solar:user-speak-rounded-linear", text: "Your agent is read and its tools are checked against the world.", hint: "A tool the world doesn't answer is named before anything runs." },
              { icon: "solar:play-circle-linear", text: "Scenarios are written and proven, then you run them once to see where the agent stands today." },
            ].map((row) => (
              <Stack key={row.text} direction="row" spacing={1.25} alignItems="flex-start">
                <Iconify icon={row.icon} width={16} sx={{ color: "text.subtitle", flexShrink: 0, mt: "1px" }} />
                <Typography component="div" sx={{ typography: "s2", color: "text.secondary" }}>
                  {row.hint ? <HintLine hint={row.hint}>{row.text}</HintLine> : row.text}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2.5, py: 2, borderTop: "1px solid", borderColor: "divider" }}>
          <Button
            variant="contained" color="primary"
            disabled={!agent}
            onClick={() => setDialogOpen(true)}
            startIcon={<Iconify icon="solar:magic-stick-3-bold" width={16} />}
            sx={{ typography: "s2", fontWeight: 700, whiteSpace: "nowrap" }}
          >
            Use environment
          </Button>
          {!agent && (
            <Typography sx={{ typography: "s3", color: "text.subtitle" }}>Pick the agent this environment is for</Typography>
          )}
        </Stack>
      </SectionCard>

      <SectionCard title="What this world gives you">
        <Stack sx={{ px: 2.5, py: 2 }} spacing={1.25}>
          <Line label="World" value={`${rows.toLocaleString()} seeded rows`} />
          <Line label="Tools" value={`${env.tools?.length || 0} the world answers`} />
          <Line label="Rules" value={`${env.rules?.length || 0} graded on every run`} />
          <Line label="Agent" value={agent ? agent.name : "Not picked yet"} muted={!agent} />
        </Stack>
      </SectionCard>

      <Box
        sx={{
          p: 2, borderRadius: 1.25, border: "1px solid",
          borderColor: alpha("#16A34A", 0.3),
          bgcolor: (t) => alpha("#16A34A", t.palette.mode === "dark" ? 0.08 : 0.04),
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="flex-start">
          <Iconify icon="solar:shield-keyhole-linear" width={16} sx={{ color: "#16A34A", flexShrink: 0, mt: "1px" }} />
          <Typography component="div" sx={{ typography: "s2", fontWeight: 700, color: "text.primary" }}>
            <HintLine hint="The world's tools answer from seeded data in an isolated sandbox. An agent that runs live on its platform still reaches its own tools — the build says so.">
              The world never touches production.
            </HintLine>
          </Typography>
        </Stack>
      </Box>

      {agent && (
        <BuildEnvironmentDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          agent={agent}
          defaultVersion={agent.production || agent.latest}
          onBuild={(choice) => build(agent, choice, templateWorldSource(template))}
        />
      )}
    </Stack>
  );
}
TemplateBuildPanel.propTypes = { template: PropTypes.object, showName: PropTypes.bool };

function Line({ label, value, muted = false }) {
  return (
    <Stack direction="row" spacing={2}>
      <Typography sx={{ typography: "s2", color: "text.subtitle", width: 96, flexShrink: 0 }}>{label}</Typography>
      <Typography sx={{ typography: "s2", fontWeight: 600, color: muted ? "text.subtitle" : "text.primary" }}>{value}</Typography>
    </Stack>
  );
}
Line.propTypes = { label: PropTypes.string, value: PropTypes.node, muted: PropTypes.bool };
