import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { Chip, Tooltip, useTheme } from "@mui/material";
import Iconify from "src/components/iconify";
import { useAgentImprovementFlag } from "src/sections/simulate-v2/_mock/featureFlags";
import { issueFixNav, useIssueFix } from "src/sections/simulate-v2/errorFeed/issueFix";
import { WATCH_DAYS } from "src/sections/simulate-v2/errorFeed/issueFixModel";
import ErrorStatusChip from "./ErrorStatusChip";

/*
  The issue's one status. Once a fix exists, the fix drives it (RSI PRD:
  "the issue shows Draft shipped · PR #123. After release it shows Watching,
  then Resolved or Reopened"). Without one, it's the issue's own triage status.
  Work in flight reads in the brand purple, shipped-and-watched in blue, the
  outcomes in the same green and red the triage chip uses; an honest ending
  (no safe improvement, couldn't reproduce) is grey.
*/
const TONE = {
  fixing: { icon: "mdi:progress-wrench", color: "#7857FC" },
  ready: { icon: "mdi:check-decagram-outline", color: "#7857FC" },
  review: { icon: "mdi:source-pull", color: "#7857FC" },
  watching: { icon: "mdi:eye-outline", color: "#0EA5E9" },
  resolved: { icon: "mdi:check-circle", color: "#5ACE6D" },
  reopened: { icon: "mdi:restore", color: "#E87878" },
  "no-fix": { icon: "mdi:close-circle-outline", color: "#938FA3" },
  "not-reproduced": { icon: "mdi:close-circle-outline", color: "#938FA3" },
};

export default function IssueStatusChip({ issue }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const improving = useAgentImprovementFlag();
  const { status } = useIssueFix(issue);
  if (!improving || !status) return <ErrorStatusChip status={issue?.status} />;
  const tone = TONE[status.key] || TONE.fixing;
  const isDark = theme.palette.mode === "dark";
  /* The detail rides along unless it's only a footnote (inconclusive count). */
  const label = status.detail && !status.label.includes("·") && status.key !== "not-reproduced" ? `${status.label} · ${status.detail}` : status.label;
  /* Opens the improvement — only when there is one to open. */
  const open = status.optId
    ? (e) => {
      e.stopPropagation();
      navigate(...issueFixNav(status, issue?.cluster_id));
    }
    : undefined;
  return (
    <Tooltip
      arrow
      title={`${status.detail && label === status.label ? `${status.label} · ${status.detail}. ` : ""}Where this issue's fix stands — opens the improvement.${["watching", "resolved", "reopened"].includes(status.key) ? ` The Error Feed watches for ${WATCH_DAYS} days after release.` : ""}`}
    >
      <Chip
        size="small"
        onClick={open}
        icon={<Iconify icon={tone.icon} width={12} sx={{ color: `${tone.color} !important`, ml: "6px !important" }} />}
        label={label}
        sx={{
          height: 22, maxWidth: 220, borderRadius: "4px", fontSize: "11px", fontWeight: 500, letterSpacing: "0.01em",
          color: tone.color,
          bgcolor: `${tone.color}${isDark ? "26" : "14"}`,
          border: "1px solid", borderColor: `${tone.color}${isDark ? "40" : "30"}`,
          cursor: open ? "pointer" : "default",
          "& .MuiChip-label": { px: "6px", lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis" },
          ...(open && { "&:hover": { opacity: 0.85, bgcolor: `${tone.color}${isDark ? "26" : "14"}` } }),
        }}
      />
    </Tooltip>
  );
}

IssueStatusChip.propTypes = { issue: PropTypes.object };
