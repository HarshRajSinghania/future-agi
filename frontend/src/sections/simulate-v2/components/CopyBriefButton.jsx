import PropTypes from "prop-types";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, ClickAwayListener, Fade, Menu, MenuItem, Paper, Popper, Stack, Tooltip, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { paths } from "src/routes/paths";
import { connectedCodingAgent, handBriefTo, startImproverSession, useIntegrations } from "../_mock/integrations";
import BrandMark from "../integrations/BrandMark";

/**
 * "Copy for coding agent" — copies a markdown brief (see
 * `_mock/codingAgentBrief`) and says so for a moment.
 *
 * The brief is built on click, not on render: it reads the whole diagnosis,
 * and nobody should pay for that on every re-render of a drawer.
 *
 * With your coding agent connected (Settings → Integrations → Coding agents) it
 * reads "Hand to Claude Code" instead: the click parks the brief for your
 * agent, which pulls it with get_brief the next time you ask — nothing opens
 * on its own, and nothing is copied. Copying stays one click
 * away on the caret. `target` says what the brief is about; an improvement
 * also starts an improver session, so the agent's attempts land there as trials.
 */

/* What to tell the coding agent to pick up — the issue, the improvement or the run. */
const targetRef = (t) => t?.issueId || t?.optId || t?.runId || "this";

const SIZES = {
  small: { typography: "s3", height: 26, px: 1, icon: 14 },
  medium: { typography: "s2", height: 30, px: 1.25, icon: 15 },
};

export default function CopyBriefButton({ getBrief, label = "Copy for coding agent", size = "medium", target, onOpened, disabledReason, sx }) {
  const navigate = useNavigate();
  const agent = connectedCodingAgent(useIntegrations());
  const [done, setDone] = useState(null); // null | "copied" | "sent"
  const [menu, setMenu] = useState(null);
  const anchor = useRef(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const flash = (what, ms) => {
    setDone(what);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(null), ms);
  };

  const copy = () => {
    try {
      navigator.clipboard?.writeText(getBrief());
    } catch {
      /* clipboard unavailable (sandbox / insecure origin) — no-op */
    }
    flash("copied", 1600);
  };

  const open = () => {
    handBriefTo({ agentId: agent.id, target, brief: getBrief() });
    if (target?.kind === "improvement") {
      startImproverSession({ agentId: agent.id, envId: target.envId, optId: target.optId, where: "future-agi" });
    }
    onOpened?.(agent);
    flash("sent", 4200);
  };

  const s = SIZES[size] || SIZES.medium;
  const base = {
    typography: s.typography, fontWeight: 700, textTransform: "none",
    color: "text.primary", borderColor: "divider",
    height: s.height, flexShrink: 0, whiteSpace: "nowrap",
    "&:hover": { borderColor: "text.primary", bgcolor: "transparent", zIndex: 1 },
  };

  /* No code to change: a coding agent has nowhere to push its candidate. */
  if (disabledReason) {
    return (
      <Tooltip arrow title={disabledReason}>
        <span>
          <Button
            size="small" variant="outlined" disabled
            startIcon={<Iconify icon="solar:copy-linear" width={s.icon} />}
            sx={{ ...base, px: s.px, ...sx }}
          >
            {label}
          </Button>
        </span>
      </Tooltip>
    );
  }

  if (!agent) {
    return (
      <Button
        size="small"
        variant="outlined"
        onClick={copy}
        startIcon={<Iconify icon={done ? "solar:check-circle-bold" : "solar:copy-linear"} width={s.icon} />}
        sx={{ ...base, px: s.px, ...sx }}
      >
        {done ? "Copied" : label}
      </Button>
    );
  }

  const markSize = Math.round(s.icon / 0.55);
  return (
    <>
      <Stack ref={anchor} direction="row" sx={{ flexShrink: 0, ...sx }}>
        <Button
          size="small"
          variant="outlined"
          onClick={open}
          startIcon={done
            ? <Iconify icon="solar:check-circle-bold" width={s.icon} />
            : <BrandMark brand={agent.id} size={markSize} tile={false} />}
          sx={{ ...base, px: s.px, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
        >
          {done === "sent" ? `Handed to ${agent.label}` : done === "copied" ? "Copied" : `Hand to ${agent.label}`}
        </Button>
        <Button
          size="small"
          variant="outlined"
          aria-label="More ways to hand off"
          onClick={(e) => setMenu(e.currentTarget)}
          sx={{ ...base, minWidth: 0, px: 0.5, ml: "-1px", borderTopLeftRadius: 0, borderBottomLeftRadius: 0, color: "text.secondary" }}
        >
          <Iconify icon="eva:chevron-down-fill" width={s.icon + 1} />
        </Button>
      </Stack>

      <Menu
        anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem onClick={() => { setMenu(null); copy(); }} sx={{ typography: "s2" }}>
          <Iconify icon="solar:copy-linear" width={15} sx={{ mr: 1, color: "text.secondary" }} />
          Copy brief instead
        </MenuItem>
        <MenuItem onClick={() => { setMenu(null); navigate(`${paths.dashboard.settings.integrations}/coding-agents`); }} sx={{ typography: "s2", color: "text.secondary" }}>
          <Iconify icon="solar:settings-linear" width={15} sx={{ mr: 1 }} />
          Coding agent settings
        </MenuItem>
      </Menu>

      {/* Not a modal — the person keeps working; it fades with the sent state. */}
      <Popper open={done === "sent"} anchorEl={anchor.current} placement="bottom-end" transition sx={{ zIndex: (t) => t.zIndex.modal + 1 }}>
        {({ TransitionProps }) => (
          <Fade {...TransitionProps} timeout={160}>
            <Box>
              <ClickAwayListener onClickAway={() => setDone(null)}>
                <Paper
                  variant="outlined"
                  sx={{ mt: 0.75, px: 1.5, py: 1, maxWidth: 300, bgcolor: "background.paper", backgroundImage: "none", boxShadow: (t) => t.customShadows?.z8 }}
                >
                  <Typography sx={{ typography: "s2", fontWeight: 600 }}>{`Ready in ${agent.label}`}</Typography>
                  <Typography sx={{ typography: "s3", color: "text.secondary", mt: 0.25 }}>
                    {`Ask it to "fix ${targetRef(target)}". It fetches the brief with `}
                    <Box component="span" sx={{ fontFamily: "ui-monospace, Menlo, monospace", color: "text.primary" }}>get_brief</Box>
                    {" and submits each change for Future AGI to check."}
                  </Typography>
                </Paper>
              </ClickAwayListener>
            </Box>
          </Fade>
        )}
      </Popper>
    </>
  );
}

CopyBriefButton.propTypes = {
  getBrief: PropTypes.func.isRequired,
  label: PropTypes.string,
  size: PropTypes.oneOf(["small", "medium"]),
  /* What the brief is about — { kind: "improvement", envId, optId } |
     { kind: "issue", issueId } | { kind: "run", envId, runId }. */
  target: PropTypes.shape({
    kind: PropTypes.oneOf(["improvement", "issue", "run"]).isRequired,
    envId: PropTypes.string,
    optId: PropTypes.string,
    issueId: PropTypes.string,
    runId: PropTypes.string,
  }),
  onOpened: PropTypes.func,
  /* Why the coding-agent route can't be used here — shown on a disabled button. */
  disabledReason: PropTypes.node,
  sx: PropTypes.object,
};
