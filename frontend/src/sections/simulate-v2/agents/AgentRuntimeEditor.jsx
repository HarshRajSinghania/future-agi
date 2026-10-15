import PropTypes from "prop-types";
import { useState } from "react";
import { useSnackbar } from "notistack";
import { Box, Button, Stack, TextField, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { useConnectedAgents } from "../store";

const MONO = "ui-monospace, Menlo, monospace";
const valid = (u) => /^(https?|wss?):\/\/\S+$/i.test(u.trim());

/**
 * Where the SDK serves the agent — the URL a simulation calls on every turn.
 * An agent read from code (repository, upload) that runs locally through the
 * SDK can be connected before serve() is running, so this can be missing;
 * until it's set (or the agent moves to the hosted sandbox, where we build it
 * ourselves), it can be versioned and read but not simulated.
 *
 * variant "prompt": the agent page's call-out when it's missing.
 * variant "embedded": the same, inside an environment's test-subject card.
 * variant "inline": the editor inside the Connection tab.
 */
export default function AgentRuntimeEditor({ agent, current, variant = "prompt", onDone }) {
  const { setAgentRuntime, setAgentValues } = useConnectedAgents();
  const { enqueueSnackbar } = useSnackbar();
  const [value, setValue] = useState(current || "");
  const ok = valid(value);

  const save = () => {
    setAgentRuntime(agent.key, value.trim());
    enqueueSnackbar(`${agent.name} runs at ${value.trim()} — ready to simulate`, { variant: "success" });
    onDone?.();
  };
  /* The other way out: let the platform build and run it (Story 6). */
  const moveToSandbox = () => {
    setAgentValues(agent.key, { runLocation: "hosted" });
    enqueueSnackbar(`${agent.name} now runs in the hosted sandbox — we build it from its code for each run.`, { variant: "success" });
    onDone?.();
  };

  const field = (
    <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ width: "100%" }}>
      <TextField
        size="small" fullWidth value={value} onChange={(e) => setValue(e.target.value)} autoFocus={variant === "inline"}
        placeholder="https://your-agent.example.com/chat" error={!!value && !ok}
        helperText={value && !ok ? "Enter a full URL starting with https://, http:// or wss://" : undefined}
        InputProps={{ sx: { typography: "s2", fontFamily: MONO } }}
        onKeyDown={(e) => { if (e.key === "Enter" && ok) save(); }}
      />
      <Button size="small" variant="contained" color="primary" disabled={!ok} onClick={save} sx={{ typography: "s2", fontWeight: 700, height: 36, flexShrink: 0 }}>Save</Button>
      {variant === "inline" && (
        <Button size="small" onClick={onDone} sx={{ typography: "s2", fontWeight: 700, height: 36, color: "text.secondary", flexShrink: 0 }}>Cancel</Button>
      )}
    </Stack>
  );

  if (variant === "inline") return field;

  const frame = variant === "embedded"
    ? { mt: 1.5, pt: 1.5, borderTop: "1px solid", borderColor: "divider" }
    : { mb: 2, p: 1.75, borderRadius: 1.5, border: "1px solid", borderColor: "divider" };
  return (
    <Box sx={frame}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ mb: 1.25 }}>
        <Iconify icon="solar:danger-triangle-linear" width={18} sx={{ color: "#CA8A04", mt: 0.125, flexShrink: 0 }} />
        <Box>
          <Typography sx={{ typography: "s2", fontWeight: 700 }}>Add where the SDK serves this agent</Typography>
          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
            {variant === "embedded"
              ? "It's set to run locally through the SDK, so a simulation calls the address serve() answers on — runs stay blocked until it has one. It applies wherever this agent is tested."
              : "It's set to run locally through the SDK, so simulations need the address serve() answers on. Until then it can be versioned and inspected, not run."}
          </Typography>
          <Typography
            role="button" tabIndex={0}
            onClick={moveToSandbox}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); moveToSandbox(); } }}
            sx={{ typography: "s3", color: "text.subtitle", cursor: "pointer", mt: 0.5, width: "fit-content", "&:hover": { color: "text.primary", textDecoration: "underline" } }}
          >
            Or run it in the hosted sandbox — we build it from the code, metered in sandbox minutes
          </Typography>
        </Box>
      </Stack>
      {field}
    </Box>
  );
}

AgentRuntimeEditor.propTypes = {
  agent: PropTypes.object.isRequired, current: PropTypes.string, variant: PropTypes.oneOf(["prompt", "embedded", "inline"]), onDone: PropTypes.func,
};
