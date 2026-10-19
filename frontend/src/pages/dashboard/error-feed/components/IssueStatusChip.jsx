import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { Box, Chip, Stack, Tooltip, Typography, useTheme } from "@mui/material";
import Iconify from "src/components/iconify";
import { useAgentImprovementFlag } from "src/sections/simulate-v2/_mock/featureFlags";
import { issueFixNav, useIssueFix } from "src/sections/simulate-v2/errorFeed/issueFix";
import { WATCH_DAYS } from "src/sections/simulate-v2/errorFeed/issueFixModel";

/*
  The fix-status chip (RSI PRD: "a fix-status chip on the list"). It sits
  beside the issue's own triage status, never in place of it; with no fix
  it renders nothing.
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
  "over-budget": { icon: "mdi:pause-circle-outline", color: "#938FA3" },
};

/* What each state of the fix means, and what happens next. */
const fixTip = (status) => {
  const { key, label } = status;
  if (key === "fixing") return "A fix is running: it reproduces the issue, then searches for a change that fixes it without breaking your must-pass scenarios.";
  if (key === "ready") {
    if (/budget/i.test(label)) return "The fix stopped at its budget. The best change it found so far is ready for you to review.";
    if (/suggestion/i.test(label)) return "The fix suggests a change it couldn't test here. Review it before you ship it.";
    return "The fix found a change that fixes this issue without breaking your must-pass scenarios. Review it and ship it.";
  }
  if (key === "review") return status.awaitingRelease
    ? "The change is saved as a draft agent version, not live yet. Mark it released on the fix once it's live — the Error Feed then watches for the issue."
    : "The change was sent as a draft, not live yet. Mark it released on the fix once it's live — the Error Feed then watches for the issue.";
  if (key === "watching") return `Released. The Error Feed watches production for ${WATCH_DAYS} days — resolved if it doesn't come back, reopened if it does.`;
  if (key === "resolved") return `Fixed: released and not seen for ${WATCH_DAYS} days.`;
  if (key === "reopened") return "Seen again on the fixed version. Fix again to try another change.";
  if (/infrastructure/i.test(label)) return "The fix couldn't finish for infrastructure reasons — not because of the agent. Try again.";
  if (key === "no-fix") return "The fix tried changes but none fixed the issue without breaking something else. Nothing was shipped.";
  if (key === "not-reproduced") return "The fix couldn't make the issue happen in the environment, so it didn't search. You can continue anyway.";
  if (key === "over-budget") return "The fix stopped at its budget before searching: checking the finalists alone would have cost more. No change was tried — Fix again with a bigger budget.";
  return "Where this issue's fix stands.";
};

/*
  In the list the fix reads as quiet text, not a second chip beside the
  triage one: an icon and the state, its detail underneath — the shape of
  the other cells. Colour only where it means something: Ready for review
  wants a person, Reopened is a regression. No fix reads "—".
*/
const EMPHASIS = { ready: { color: "text.primary", icon: "#7857FC", weight: 600 }, reopened: { color: "#DC2626", icon: "#DC2626", weight: 600 } };

export default function IssueStatusChip({ issue, variant = "chip" }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const improving = useAgentImprovementFlag();
  const { status } = useIssueFix(issue);
  if (!improving) return null;
  if (!status) {
    return variant === "text" ? <Typography sx={{ typography: "s3", color: "text.disabled" }}>—</Typography> : null;
  }
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
  const tip = `${status.detail && label === status.label ? `${status.label} · ${status.detail}. ` : ""}${fixTip(status)}${open ? " Click to open the fix." : ""}`;

  if (variant === "text") {
    /* "Fix in review · Vapi copy" → the state, then its detail underneath. */
    const [head, ...rest] = status.label.split(" · ");
    const detail = rest.join(" · ") || (status.key !== "not-reproduced" ? status.detail : null) || null;
    const em = EMPHASIS[status.key];
    return (
      <Tooltip arrow title={tip} placement="top-start">
        <Stack
          direction="row" spacing={0.875} alignItems="flex-start"
          onClick={open}
          sx={{ minWidth: 0, maxWidth: "100%", cursor: open ? "pointer" : "default", "&:hover .fix-head": open ? { textDecoration: "underline" } : undefined }}
        >
          <Iconify icon={tone.icon} width={14} sx={{ color: em?.icon || "text.subtitle", flexShrink: 0, mt: "2px" }} />
          <Box minWidth={0}>
            <Typography className="fix-head" noWrap sx={{ typography: "s2", fontWeight: em?.weight || 500, color: em?.color || "text.secondary" }}>{head}</Typography>
            {detail && <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>{detail}</Typography>}
          </Box>
        </Stack>
      </Tooltip>
    );
  }

  return (
    <Tooltip
      arrow
      title={tip}
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

IssueStatusChip.propTypes = { issue: PropTypes.object, variant: PropTypes.oneOf(["chip", "text"]) };
