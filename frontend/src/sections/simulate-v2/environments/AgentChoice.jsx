import PropTypes from "prop-types";
import { Suspense, lazy, useMemo, useState } from "react";
import { alpha } from "@mui/material/styles";
import { Box, Button, ButtonBase, IconButton, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { useConnectedAgents } from "../store";
import { agentSourceOf } from "../_mock/agentRegistry";
import { useSaveConnectedAgent } from "../agents/connect/useSaveConnectedAgent";
import { ConnectSubmitContext } from "../agents/connect/connectSubmit";
import BuildEnvironmentDialog from "../agents/BuildEnvironmentDialog";
import SideDrawer from "../components/SideDrawer";
import { SectionHead } from "./LandingBits";
import { PANEL_SX, focusRing } from "./landingStyles";
import { buildableAgentsOf, useBuildForAgent } from "./worldSource";

/*
  Choosing the agent an environment belongs to (RSI PRD Flow 2, step 1:
  "Connect: pick the agent from Agents").

  · YourAgentsSection — the top of the Environments landing: every agent in
    Agents, each opening the same Build environment dialog the agent page
    uses (name, version, 10–1,000 scenarios), then the builder.
  · WorldAgentPicker — where a world source (a prebuilt world, an MCP server,
    a SaaS sandbox) is set up: pick one of your agents, or connect a new one
    here, before anything is built.
*/

/* Loaded on demand: the picker reaches back into StartEnvironment (FlowPanel),
   which imports this file — a static import would close a cycle. */
const ConnectAgentPicker = lazy(() => import("../agents/connect/ConnectAgentPicker"));

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* "Vapi · v3 in production · 2 environments" */
const metaLine = (a) => {
  const src = agentSourceOf(a);
  const envs = a.usedIn?.length || 0;
  return [src.label, `${a.production || a.latest || "v1"} in production`, envs ? plural(envs, "environment") : "No environment yet"].join(" · ");
};

/* ── Your agents (landing) ──────────────────────────────────────────────── */

const FIRST_SHOWN = 6;

export function YourAgentsSection({ sectionRef }) {
  const { agents: all } = useConnectedAgents();
  const agents = useMemo(() => buildableAgentsOf(all), [all]);
  const [showAll, setShowAll] = useState(false);
  const [buildFor, setBuildFor] = useState(null);
  const build = useBuildForAgent();
  const shown = showAll ? agents : agents.slice(0, FIRST_SHOWN);

  return (
    <Box ref={sectionRef} sx={{ scrollMarginTop: 16 }}>
      <SectionHead
        title="Your agents"
        subtitle="Every environment belongs to one agent in Agents. Pick one to build an environment for it — the version to test and how many scenarios to start with come next."
        action={agents.length > FIRST_SHOWN ? (
          <Button size="small" onClick={() => setShowAll((v) => !v)} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary" }}>
            {showAll ? "Show fewer" : `Show all ${agents.length}`}
          </Button>
        ) : null}
      />
      {agents.length ? (
        <Box sx={{ ...PANEL_SX, overflow: "hidden" }}>
          {shown.map((a, i) => (
            <AgentRow
              key={a.id}
              agent={a}
              divider={i > 0}
              action="Build environment"
              onClick={() => setBuildFor(a)}
            />
          ))}
        </Box>
      ) : (
        <Typography sx={{ typography: "s2", color: "text.subtitle", px: 2, py: 1.5, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
          No agents in Agents yet. Connect one below — its environment builds next.
        </Typography>
      )}
      {buildFor && (
        <BuildEnvironmentDialog
          open
          onClose={() => setBuildFor(null)}
          agent={buildFor}
          defaultVersion={buildFor.production || buildFor.latest}
          onBuild={(choice) => build(buildFor, choice)}
        />
      )}
    </Box>
  );
}
YourAgentsSection.propTypes = { sectionRef: PropTypes.object };

function AgentRow({ agent, divider, action, selected = false, onClick }) {
  const src = agentSourceOf(agent);
  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={selected || undefined}
      sx={{
        width: "100%", px: 2, py: 1.25, display: "flex", alignItems: "center", gap: 1.5, textAlign: "left",
        borderTop: divider ? "1px solid" : "none", borderColor: "divider",
        bgcolor: (t) => (selected ? alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.06 : 0.03) : "transparent"),
        "&:hover": { bgcolor: (t) => alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.05 : 0.025) },
        "&:hover .agent-go": { color: "text.primary" },
        "&.Mui-focusVisible": focusRing,
      }}
    >
      <Iconify icon={src.icon} width={16} sx={{ color: "text.secondary", flexShrink: 0 }} />
      <Box flex={1} minWidth={0}>
        <Typography noWrap sx={{ typography: "s2", fontWeight: 600 }}>{agent.name}</Typography>
        <Typography noWrap sx={{ typography: "s3", color: "text.subtitle", fontVariantNumeric: "tabular-nums" }}>{metaLine(agent)}</Typography>
      </Box>
      {action ? (
        <Stack className="agent-go" direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0, color: "text.secondary", typography: "s2", fontWeight: 700 }}>
          <span>{action}</span>
          <Iconify icon="solar:arrow-right-linear" width={14} />
        </Stack>
      ) : (
        <Iconify
          icon={selected ? "solar:check-circle-bold" : "solar:circle-linear"}
          width={16}
          sx={{ color: selected ? "text.primary" : "text.disabled", flexShrink: 0 }}
        />
      )}
    </ButtonBase>
  );
}
AgentRow.propTypes = {
  agent: PropTypes.object.isRequired, divider: PropTypes.bool, action: PropTypes.string,
  selected: PropTypes.bool, onClick: PropTypes.func,
};

/* ── the agent a world source builds for ───────────────────────────────── */

/**
 * Pick the agent this world becomes an environment for — one of yours, or a
 * new one connected here (the same flows as Agents → New agent). `value` is
 * the agent's id.
 */
export default function WorldAgentPicker({ value, onChange, title = "Agent", subtitle = null }) {
  const { agents: all } = useConnectedAgents();
  const agents = useMemo(() => buildableAgentsOf(all), [all]);
  const saveAgent = useSaveConnectedAgent();
  const [connecting, setConnecting] = useState(false);
  const onConnected = (source) => {
    const { id } = saveAgent(source);
    setConnecting(false);
    onChange(id);
  };
  return (
    <Box>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.75 }}>
        <Typography sx={{ typography: "s2", fontWeight: 700 }}>{title}</Typography>
        <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1, minWidth: 0 }}>
          {subtitle || "The environment belongs to this agent in Agents."}
        </Typography>
        <Button
          size="small"
          onClick={() => setConnecting(true)}
          startIcon={<Iconify icon="solar:add-circle-linear" width={14} />}
          sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", flexShrink: 0 }}
        >
          Connect a new agent
        </Button>
      </Stack>
      {agents.length ? (
        <Box role="radiogroup" sx={{ ...PANEL_SX, maxHeight: 248, overflowY: "auto" }}>
          {agents.map((a, i) => (
            <AgentRow key={a.id} agent={a} divider={i > 0} selected={a.id === value} onClick={() => onChange(a.id)} />
          ))}
        </Box>
      ) : (
        <Typography sx={{ typography: "s2", color: "text.subtitle", px: 1.75, py: 1.25, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
          No agents in Agents yet — connect one to build its environment from this world.
        </Typography>
      )}

      <SideDrawer open={connecting} onClose={() => setConnecting(false)} width={760}>
        <Stack sx={{ height: "100%" }}>
          <Stack direction="row" alignItems="flex-start" spacing={2} sx={{ px: 2.5, py: 2, borderBottom: "1px solid", borderColor: "divider", flexShrink: 0 }}>
            <Box flex={1} minWidth={0}>
              <Typography sx={{ typography: "m2", fontWeight: 600 }}>Connect a new agent</Typography>
              <Typography sx={{ typography: "s2", color: "text.subtitle", mt: 0.25 }}>
                It joins Agents, and this environment is built for it.
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => setConnecting(false)} aria-label="Close">
              <Iconify icon="eva:close-fill" width={18} sx={{ color: "text.secondary" }} />
            </IconButton>
          </Stack>
          <Box sx={{ flex: 1, overflow: "auto", p: 2.5 }}>
            {connecting && (
              <Suspense fallback={null}>
                <ConnectSubmitContext.Provider value="Connect agent">
                  <ConnectAgentPicker onConnect={onConnected} flowsIn="inline" />
                </ConnectSubmitContext.Provider>
              </Suspense>
            )}
          </Box>
        </Stack>
      </SideDrawer>
    </Box>
  );
}
WorldAgentPicker.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  title: PropTypes.string,
  subtitle: PropTypes.string,
};
