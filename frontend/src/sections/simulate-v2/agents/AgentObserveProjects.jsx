import PropTypes from "prop-types";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Divider, Menu, MenuItem, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { paths } from "src/routes/paths";
import { useConnectedAgents, useSimStore } from "../store";
import { knownProjects, projectsOfAgent } from "../_mock/projectLinks";
import { InfoTip } from "./AgentBits";
import { useErrorFeedStore } from "src/pages/dashboard/error-feed/store";

const HOW = {
  set: "Linked",
  watching: "Its production calls land here",
  seeded: "Reports here",
};

/**
 * The Observe projects this agent's traces land in. Issues from them reach
 * Fix and Copy for coding agent as this agent's, and the environments testing
 * it can import them as scenarios. A project's agent is a setting of the
 * project — linking one here is the same as linking it from the Error Feed.
 */
export function ObserveProjectsCard({ agent }) {
  const navigate = useNavigate();
  const { state, dispatch } = useSimStore();
  const { agents } = useConnectedAgents();
  const [anchor, setAnchor] = useState(null);
  const mine = useMemo(() => projectsOfAgent(agent, state, agents), [agent, state, agents]);
  /* Projects that could be this agent's: the ones with no agent yet. */
  const open = useMemo(
    () => knownProjects(state, agents).filter((p) => p.link.status !== "linked"),
    [state, agents],
  );
  const link = (project, key) => dispatch({ type: "linkProjectAgent", project, agentKey: key });

  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper", overflow: "hidden" }}>
      {mine.map((p, i) => (
        <Stack
          key={p.project} direction="row" alignItems="center" spacing={1.5}
          sx={{ px: 2, py: 1, borderTop: i ? "1px solid" : "none", borderColor: "divider" }}
        >
          <Iconify icon="solar:folder-with-files-linear" width={15} sx={{ color: "text.disabled", flexShrink: 0 }} />
          <Box flex={1} minWidth={0}>
            <Typography noWrap sx={{ typography: "s2", fontWeight: 600 }}>{p.name}</Typography>
            <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>{HOW[p.how] || "Linked"}</Typography>
          </Box>
          {/* Its issues — the Error Feed filtered to this project. */}
          <Button
            size="small"
            onClick={() => { useErrorFeedStore.getState().setSelectedProject(p.project); navigate(paths.dashboard.errorFeed.root); }}
            sx={{ typography: "s3", fontWeight: 700, color: "text.primary", minWidth: 0 }}
          >
            View issues
          </Button>
          {p.how === "set" && (
            <Button size="small" onClick={() => link(p.project, null)} sx={{ typography: "s3", fontWeight: 600, color: "text.secondary", minWidth: 0 }}>
              Unlink
            </Button>
          )}
        </Stack>
      ))}
      {!mine.length && (
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography sx={{ typography: "s2" }}>No project yet</Typography>
          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
            The Error Feed can&apos;t tell its issues apart, or fix them, until a project that traces it is linked.
          </Typography>
        </Box>
      )}
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1, borderTop: "1px solid", borderColor: "divider" }}>
        <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1 }}>
          One agent per project
          <InfoTip text="A project traces one agent; an agent can have several projects — production and staging, a voice line and a chat window. Issues from them are fixed against this agent." />
        </Typography>
        <Button
          size="small" onClick={(e) => setAnchor(e.currentTarget)}
          startIcon={<Iconify icon="solar:add-circle-linear" width={15} />}
          sx={{ typography: "s3", fontWeight: 700, color: "text.primary" }}
        >
          Link a project
        </Button>
      </Stack>
      <Menu
        anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: 300, mt: 0.5 } } }}
      >
        {open.map((p) => (
          <MenuItem key={p.id} onClick={() => { setAnchor(null); link(p.id, agent.key); }} sx={{ alignItems: "flex-start", py: 1 }}>
            <Box minWidth={0}>
              <Typography noWrap sx={{ typography: "s2", fontWeight: 500 }}>{p.name}</Typography>
              <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>
                {["No agent yet", p.traces].filter(Boolean).join(" · ")}
              </Typography>
            </Box>
          </MenuItem>
        ))}
        {!open.length && (
          <MenuItem disabled sx={{ typography: "s3" }}>Every project already has its agent</MenuItem>
        )}
        <Divider />
        <MenuItem onClick={() => { setAnchor(null); navigate(paths.dashboard.observe); }} sx={{ typography: "s2", gap: 1 }}>
          <Iconify icon="solar:add-circle-linear" width={15} sx={{ color: "text.secondary" }} />
          New project in Observe
        </MenuItem>
      </Menu>
    </Box>
  );
}
ObserveProjectsCard.propTypes = { agent: PropTypes.object.isRequired };
