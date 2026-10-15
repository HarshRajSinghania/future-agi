import PropTypes from "prop-types";
import { Box, Button, Dialog, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { latestEnvVersion, toolFit } from "../_mock/toolFit";
import { ToolList } from "../workspace/toolFitParts";
import { useRebuildForAgent } from "../workspace/useRebuildForAgent";
import { nextSnapshotLabel } from "../_mock/envSnapshot";
import { envLabelOf } from "../_mock/envVersionKinds";

/**
 * Asked before a run whose agent calls a tool the world can't answer.
 *
 * It warns rather than blocks: calls to that tool get no answer, so those
 * scenarios come back not measured — an environment gap is never scored as
 * the agent's failure — and sometimes running the rest is exactly what
 * someone wants. So there are three ways out — fix the environment and run,
 * run anyway, or cancel — and the recommended one is the loud button.
 */
export default function RunFitDialog({ open, onClose, env, envState, patch, agent, onRun, locked = false }) {
  const rebuild = useRebuildForAgent(env, envState, patch);
  if (!open || !agent) return null;

  const fit = toolFit(env, envState, { agent });
  const latest = latestEnvVersion(env, envState);
  const latestFits = latest && latest.label !== fit.envVersion
    && toolFit(env, envState, { agent, envVersion: latest.label }).fits;
  const n = fit.missing.length;
  /* Environment versions as people read them (snapshots of world, scenarios, evals). */
  const nextLabel = nextSnapshotLabel(env, envState);
  const latestShown = latest ? envLabelOf(env, envState, latest.label) : null;

  const fixAndRun = () => {
    if (latestFits) patch({ activeEnvVersion: latest.label });
    else rebuild(agent);
    onClose();
    onRun();
  };

  const runAnyway = () => {
    onClose();
    onRun();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperProps={{ sx: { width: 560, maxWidth: "calc(100% - 32px)", p: 3, borderRadius: 2, backgroundImage: "none" } }}
    >
      <Box
        sx={{
          width: 36, height: 36, borderRadius: 1, display: "grid", placeItems: "center", mb: 1.75,
          bgcolor: "action.hover", color: "text.primary",
        }}
      >
        <Iconify icon="solar:plug-circle-linear" width={20} />
      </Box>
      <Typography sx={{ typography: "m3", fontWeight: 700 }}>
        Agent {agent} calls {n === 1 ? "a tool" : `${n} tools`} environment {fit.envVersion} can&apos;t answer
      </Typography>
      <Typography component="div" sx={{ typography: "s2", color: "text.secondary", mt: 1 }}>
        It calls <ToolList tools={fit.missing} />, which this world doesn&apos;t know how to answer. Scenarios where it
        calls {n === 1 ? "it" : "them"} get no answer back, so they can&apos;t be scored and come back as{" "}
        <b>not measured</b> — the rest of the run still tests {agent}.
      </Typography>

      <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: "action.hover" }}>
        <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
          {locked
            ? "This is a template preview, so its world can't be rebuilt or switched here — fork it to fix the environment."
            : latestFits
            ? `Environment ${latestShown} already answers ${n === 1 ? "this tool" : "these tools"} — switch to it for a clean run.`
            : `Rebuilding makes environment ${nextLabel}: the world learns ${n === 1 ? "the tool" : "the tools"}, and new scenarios are added to test ${n === 1 ? "it" : "them"}. Older environment versions stay as they are.`}
        </Typography>
      </Box>

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 2.5 }}>
        <Button size="small" onClick={onClose} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary" }}>
          Cancel
        </Button>
        <Box flex={1} />
        <Button
          size="small" variant="outlined"
          onClick={runAnyway}
          sx={{
            typography: "s2", fontWeight: 600, color: "text.primary", borderColor: "divider",
            "&:hover": { borderColor: "text.disabled", bgcolor: "action.hover" },
          }}
        >
          Run on {fit.envVersion} anyway
        </Button>
        {!locked && (
        <Button
          size="small" variant="contained" color="primary"
          onClick={fixAndRun}
          startIcon={<Iconify icon={latestFits ? "solar:transfer-horizontal-linear" : "solar:refresh-linear"} width={15} />}
          sx={{ typography: "s2", fontWeight: 700 }}
        >
          {latestFits ? `Use environment ${latestShown} and run` : "Rebuild and run"}
        </Button>
        )}
      </Stack>
    </Dialog>
  );
}

RunFitDialog.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  env: PropTypes.object,
  envState: PropTypes.object,
  patch: PropTypes.func.isRequired,
  agent: PropTypes.string,
  onRun: PropTypes.func.isRequired,
  locked: PropTypes.bool,
};
