import PropTypes from "prop-types";
import { Box, Button, Dialog, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { toolFit } from "../_mock/toolFit";
import { currentAgentVersion } from "../_mock/versions";

const MONO = "ui-monospace, Menlo, monospace";

/**
 * Switch which agent version an environment tests. Nothing runs — the next
 * run uses it — and earlier runs stay with the version they ran. If the new
 * version calls a tool this environment's world doesn't answer, say so
 * before switching rather than after a run fails.
 */
export default function SwitchVersionDialog({ open, onClose, env, envState, label, onConfirm }) {
  if (!env || !envState || !label) return null;
  const from = envState.activeAgentVersion || currentAgentVersion(envState)?.label;
  const fit = toolFit(env, envState, { agent: label });

  return (
    <Dialog
      open={open} onClose={onClose}
      PaperProps={{ sx: { borderRadius: 2, maxWidth: 480, width: "100%", bgcolor: "background.paper", backgroundImage: "none", border: "1px solid", borderColor: "divider" } }}
    >
      <Box sx={{ px: 3, pt: 2.5, pb: 2 }}>
        <Typography sx={{ typography: "m3", fontWeight: 700 }}>{`Switch ${env.name} to ${label}?`}</Typography>
        <Typography sx={{ typography: "s2", color: "text.secondary", mt: 0.75 }}>
          {`Its next run tests ${label}. Nothing runs now, and earlier runs stay with ${from || "the version they ran"} — results compare version to version.`}
        </Typography>
        {!fit.fits && (
          <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mt: 1.75, p: 1.25, borderRadius: 1, bgcolor: (t) => alpha("#CA8A04", t.palette.mode === "dark" ? 0.12 : 0.08) }}>
            <Iconify icon="solar:danger-triangle-linear" width={16} sx={{ color: "#CA8A04", mt: 0.125, flexShrink: 0 }} />
            <Typography sx={{ typography: "s3", color: "text.primary" }}>
              {`${label} calls ${fit.missing.length === 1 ? "a tool" : "tools"} this environment's world doesn't answer: `}
              <Box component="span" sx={{ fontFamily: MONO }}>{fit.missing.map((t) => t.name).join(", ")}</Box>
              {`. Scenarios that need ${fit.missing.length === 1 ? "it" : "them"} come back Not measured until the world is updated from the environment's World tab.`}
            </Typography>
          </Stack>
        )}
      </Box>
      <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ px: 3, py: 1.75, borderTop: "1px solid", borderColor: "divider" }}>
        <Button size="small" onClick={onClose} sx={{ typography: "s2", fontWeight: 700, color: "text.secondary" }}>Cancel</Button>
        <Button size="small" variant="contained" color="primary" onClick={onConfirm} sx={{ typography: "s2", fontWeight: 700 }}>
          {fit.fits ? `Switch to ${label}` : `Switch anyway`}
        </Button>
      </Stack>
    </Dialog>
  );
}

SwitchVersionDialog.propTypes = {
  open: PropTypes.bool, onClose: PropTypes.func, env: PropTypes.object, envState: PropTypes.object,
  label: PropTypes.string, onConfirm: PropTypes.func,
};
