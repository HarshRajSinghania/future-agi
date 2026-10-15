import PropTypes from "prop-types";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Stack, Tooltip, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { paths } from "src/routes/paths";
import { useAgentImprovementFlag } from "../_mock/featureFlags";
import { issueFixNav, issueProjectLinkOf, useIssueFix } from "./issueFix";
import ConnectAgentDialog from "./ConnectAgentDialog";
import { clickable, focusRing } from "../components/clickable";

const btnSx = { height: 30, fontSize: "12px", borderRadius: "6px", textTransform: "none" };

/*
  What the button does at each point of the fix (RSI PRD, Flow 3 and Part 3
  "Improvement states"): an issue has at most one fix in flight. Once a fix
  is running, waiting for review, shipped or being watched, the button opens
  that fix — it never starts a second one against the version the first fix
  produced. Only an ending that left the issue unfixed (no safe improvement,
  could not reproduce, failed) or a Reopened issue offers Fix again.
*/
const IN_FLIGHT = {
  fixing: { label: "View fix", why: "A fix is running for this issue — open it to follow the search." },
  ready: { label: "Review fix", why: "The fix finished — review the verdict and ship it as a draft." },
  review: { label: "View fix", why: "The fix is shipped as a draft. Once it's deployed, mark it released on the fix — the Error Feed then watches for the issue." },
  watching: { label: "View fix", why: "The fix is released and the Error Feed is watching for this issue. If it comes back, the issue reopens and Fix again starts a new fix." },
  resolved: { label: "View fix", why: "The fix held through the watch window." },
};
const AGAIN = new Set(["reopened", "no-fix", "not-reproduced"]);

/**
 * Fix on an Error Feed issue. It opens the Fix sheet — Future AGI's engine
 * finds and proves the change. (Your own coding agent comes in through Copy
 * for coding agent instead, PRD Flow 6.)
 *
 * The agent is never picked here. An agent in Agents records the Observe
 * project its traces land in (PRD, Agents → Links); Fix reads that. An issue
 * whose project no agent records reads Connect agent to fix (Flow 3): a
 * dialog over the issue connects it with this project already linked.
 *
 * Fix starts on confirmed issues only (PRD, Risks: "Fix only on confirmed
 * issues"); an emerging or dismissed one says why.
 */
export default function FixButton({ issue, onOpenSheet }) {
  const navigate = useNavigate();
  const improving = useAgentImprovementFlag();
  const { agent, agents, state, tracing, gate, evidence, status } = useIssueFix(issue);
  /* Controlled so a link inside it closes it before it navigates. */
  const [tip, setTip] = useState(false);
  const [connecting, setConnecting] = useState(false);
  /* The issue's project, and the agent that records it. */
  const link = issueProjectLinkOf(issue, state, agents);
  if (!improving) return null;

  const openFix = () => status?.optId && navigate(...issueFixNav(status, issue?.cluster_id));
  const openConnections = () => navigate(`${paths.dashboard.agents}/connected/${agent.id}?tab=connections`);

  /* Reopened with the change it came back on: the banner under the header
     carries View fix and Fix again, so the header doesn't repeat them. */
  if (agent && status?.key === "reopened" && status.change) return null;

  /* A fix already in flight: open it. */
  const inFlight = status && IN_FLIGHT[status.key];
  if (agent && inFlight) {
    return (
      <Tooltip arrow title={`${status.label}${status.detail ? ` · ${status.detail}` : ""}. ${inFlight.why}`}>
        <Button
          variant="outlined" onClick={openFix}
          startIcon={<Iconify icon="mdi:wrench-outline" width={13} />}
          sx={{ ...btnSx, borderColor: "divider", color: "text.primary" }}
        >
          {inFlight.label}
        </Button>
      </Tooltip>
    );
  }

  /* Disconnected, archived, Coming soon, or waiting on live-test consent —
     said on the button, with the way out when there is one. */
  const blocked = !!agent && (!tracing || !!gate);
  /* Not confirmed yet — Fix waits. */
  const unconfirmed = !!agent && !blocked && !!evidence;
  const again = !!status && AGAIN.has(status.key);

  const why = gate ? (
    <Box sx={{ py: 0.25 }}>
      <Typography sx={{ typography: "s3", fontWeight: 700 }}>{gate.title}</Typography>
      <Typography sx={{ typography: "s3", mt: 0.25 }}>{gate.body}</Typography>
      {gate.action === "connections" && (
        <Typography
          {...clickable(() => { setTip(false); openConnections(); })}
          sx={{ typography: "s3", fontWeight: 700, mt: 0.5, cursor: "pointer", textDecoration: "underline", ...focusRing }}
        >
          Open the agent&apos;s Connections tab
        </Typography>
      )}
    </Box>
  ) : blocked
    ? `Fix needs ${agent.name}'s production traces. Turn on Watch production calls on the agent's Connections tab — simulations still run without it.`
    : unconfirmed ? (
      <Box sx={{ py: 0.25 }}>
        <Typography sx={{ typography: "s3", fontWeight: 700 }}>{`Fix starts on confirmed issues · ${evidence.title}`}</Typography>
        <Typography sx={{ typography: "s3", mt: 0.25 }}>{evidence.body}</Typography>
      </Box>
    ) : !agent
      ? `No agent in Agents is linked to ${link.name || "this issue's project"}. Connect it once — this project comes with it, and Fix works for every issue from it.`
      : again
        ? `${status.label}${status.detail ? ` · ${status.detail}` : ""}. Fix again starts a new fix; the last one stays on its page.`
        : "";

  return (
    <Stack direction="row" alignItems="center" spacing={0.75}>
      {again && (
        <Button size="small" onClick={openFix} sx={{ ...btnSx, color: "text.secondary" }}>
          Last fix
        </Button>
      )}
      <Tooltip arrow title={why} open={tip && !!why} onOpen={() => setTip(true)} onClose={() => setTip(false)}>
        <span>
          {agent ? (
            <Button
              variant="contained" color="primary" disabled={blocked || unconfirmed}
              startIcon={<Iconify icon="mdi:wrench-outline" width={13} />}
              onClick={onOpenSheet}
              sx={{ ...btnSx, boxShadow: "none" }}
            >
              {again ? "Fix again" : "Fix"}
            </Button>
          ) : (
            <Button
              variant="contained" color="primary"
              startIcon={<Iconify icon="mdi:wrench-outline" width={13} />}
              onClick={() => { setTip(false); setConnecting(true); }}
              sx={{ ...btnSx, boxShadow: "none" }}
            >
              Connect agent to fix
            </Button>
          )}
        </span>
      </Tooltip>
      {!agent && <ConnectAgentDialog open={connecting} onClose={() => setConnecting(false)} issue={issue} project={link.project} />}
    </Stack>
  );
}

FixButton.propTypes = { issue: PropTypes.object, onOpenSheet: PropTypes.func };
