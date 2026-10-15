import PropTypes from "prop-types";
import { Tooltip, Typography } from "@mui/material";
import { useConnectedAgents, useSimStore } from "../store";
import { agentSourceOf } from "../_mock/agentRegistry";
import { issueProjectLinkOf } from "./issueFixModel";

/**
 * The agent behind an Error Feed issue, for the list — the one its Observe
 * project is linked to. "No agent" when none is, so it's clear at a glance
 * which issues Fix can work on.
 */
export default function IssueAgentCell({ issue }) {
  const { state } = useSimStore();
  const { agents } = useConnectedAgents();
  const link = issueProjectLinkOf(issue, state, agents);
  const name = link.status === "linked" ? link.agent?.name || "Agent" : null;
  /* Where it runs — Vapi, Retell, Bland, a repository — so the source reads at a glance. */
  const source = name && link.agent ? agentSourceOf(link.agent).label : null;
  return (
    <Tooltip arrow title={name ? `${link.name} → ${name}${source ? ` · ${source}` : ""}` : `${link.name || "Its project"} isn't linked to an agent in Agents — Connect agent to fix on the issue.`}>
      <Typography noWrap sx={{ typography: "s2", color: name ? "text.primary" : "text.disabled" }}>
        {name || "No agent"}
        {source && <Typography component="span" sx={{ typography: "s2", color: "text.subtitle" }}>{` · ${source}`}</Typography>}
      </Typography>
    </Tooltip>
  );
}
IssueAgentCell.propTypes = { issue: PropTypes.object };
