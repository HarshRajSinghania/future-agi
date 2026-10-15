import React from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Box, Stack, Tab, Tooltip, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { SegmentedTabs } from "src/components/tabs/tabs";
import { paths } from "src/routes/paths";
import ConnectedAgentsView from "src/sections/simulate-v2/agents/ConnectedAgentsView";
import AgentView from "./AgentView";
import CreateAgentsButton from "./components/CreateAgentsButton";
import useCanEditAgent from "./hooks/useCanEditAgent";
import { useAgentImprovementFlag } from "src/sections/simulate-v2/_mock/featureFlags";

/**
 * Agents — the ones built here in the Playground, and the ones that live
 * elsewhere and were connected to run simulations against.
 */
export default function AgentsLanding() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  /* Connected agents is where improvements start, so it opens first when
     agent improvement is on; the Playground stays one click away. */
  const improving = useAgentImprovementFlag();
  const asked = params.get("tab");
  const tab = asked === "connected" || asked === "playground" ? asked : improving ? "connected" : "playground";
  const { canCreate } = useCanEditAgent();

  return (
    <>
      <Helmet><title>Agents</title></Helmet>
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column", p: 2, gap: 1.5, minHeight: 0, overflow: "hidden" }}>
        <Stack direction="row" alignItems="center" spacing={0.75}>
          <Typography typography="m2" fontWeight="fontWeightMedium" color="text.primary">Agents</Typography>
          <Tooltip arrow title="Build agents in the Playground, or connect agents that already run somewhere else to test them in simulations.">
            <Box sx={{ display: "flex", color: "text.subtitle" }}>
              <Iconify icon="solar:info-circle-linear" width={16} />
            </Box>
          </Tooltip>
        </Stack>

        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <SegmentedTabs
            value={tab}
            onChange={(_, v) => setParams({ tab: v }, { replace: true })}
          >
            <Tab value="connected" label="Connected agents" disableRipple />
            <Tab value="playground" label="Agent Playground" disableRipple />
          </SegmentedTabs>
          <CreateAgentsButton canCreatePlayground={canCreate} />
        </Stack>

        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {tab === "playground"
            ? <AgentView embedded />
            : <ConnectedAgentsView onConnect={() => navigate(`${paths.dashboard.agents}/connect`)} />}
        </Box>
      </Box>
    </>
  );
}
