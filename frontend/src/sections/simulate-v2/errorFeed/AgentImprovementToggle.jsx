import { useState } from "react";
import { Box, Button, Popover, Stack, Switch, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { useSimStore } from "../store";
import {
  AGENT_IMPROVEMENT, PREVIEW_LABEL, PREVIEW_NOTE, announceFlags, clearFlagOverride, useAgentImprovementFlag,
} from "../_mock/featureFlags";

/**
 * The workspace switch for agent improvement — Fix on the Error Feed, the
 * Improvements list and New improvement. Phase 1 is a design partner
 * preview, so the switch says so. Sits in the Error Feed header: it is where
 * Fix lives, and it stays reachable when the feature is off.
 */
export default function AgentImprovementToggle() {
  const { commit } = useSimStore();
  const on = useAgentImprovementFlag();
  const [anchor, setAnchor] = useState(null);
  const set = (next) => {
    clearFlagOverride(AGENT_IMPROVEMENT);
    commit({ type: "setFlag", flag: AGENT_IMPROVEMENT, on: next });
    announceFlags();
  };
  return (
    <>
      <Button
        variant="outlined" size="small"
        onClick={(e) => setAnchor(e.currentTarget)}
        startIcon={<Iconify icon="solar:test-tube-linear" width={15} />}
        endIcon={<Iconify icon="solar:alt-arrow-down-linear" width={12} />}
        sx={{ height: 32, fontSize: "13px", borderColor: "divider", color: "text.secondary", borderRadius: "6px", textTransform: "none" }}
      >
        {`${PREVIEW_LABEL} · ${on ? "On" : "Off"}`}
      </Button>
      <Popover
        open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: 320, mt: 0.5 } } }}
      >
        <Stack direction="row" alignItems="flex-start" spacing={1.25} sx={{ p: 1.75 }}>
          <Box flex={1} minWidth={0}>
            <Typography sx={{ typography: "s2", fontWeight: 600 }}>Agent improvement</Typography>
            <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>{PREVIEW_NOTE}</Typography>
            <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.75 }}>
              {on
                ? "On for this workspace: the Fix button on every issue, the Improvements list and Run improvement on a run's Debug failures."
                : "Off: the Fix button, the Improvements list and Run improvement are hidden. Simulations and the Error Feed work as before."}
            </Typography>
          </Box>
          <Switch size="small" checked={on} onChange={(e) => set(e.target.checked)} inputProps={{ "aria-label": "Agent improvement" }} sx={{ flexShrink: 0, mt: "-2px" }} />
        </Stack>
      </Popover>
    </>
  );
}
