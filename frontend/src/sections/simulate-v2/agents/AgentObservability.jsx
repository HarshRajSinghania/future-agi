import PropTypes from "prop-types";
import { useState } from "react";
import { Box, Button, Stack, Switch, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import AgentTracingCard from "./AgentTracingCard";
import { MONO, ago } from "./agentViewUtils";
import { InfoTip } from "./AgentBits";
import { clickable, focusRing } from "../components/clickable";

/*
  Watching an agent's production calls, wherever it's shown. How it's turned
  on depends on how the agent is connected (see _mock/observability.js):
    platform — one switch; calls come through the provider API key
    traceai  — a repository: one pull request adds traceAI
    sdk      — an endpoint: the team adds a short snippet, then confirms
*/

const WHY = "Simulation shows how the agent might behave; production shows how it does. Watching real calls puts them next to your simulations, feeds Error Feed, and lets you turn failures into scenarios.";

const snippetFor = (project) => `from fi_instrumentation import register

tracer = register(project_name="${project}")
# then instrument your framework, e.g. OpenAIInstrumentor().instrument(tracer_provider=tracer)`;

/** Overview — one line: how production is doing, or that it isn't watched. */
export function ObservabilityStrip({ agent, observe, summary, onOpen, onTurnOn, onSetUp }) {
  if (observe.mode === "traceai" && !observe.on) return <AgentTracingCard agent={agent} />;
  if (observe.on) {
    return (
      <Stack
        direction="row" alignItems="center" spacing={1.25} {...clickable(onOpen)}
        sx={{ mb: 2, px: 1.5, py: 1, borderRadius: 1.25, border: "1px solid", borderColor: "divider", cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, ...focusRing }}
      >
        <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "#16A34A", flexShrink: 0 }} />
        <Typography sx={{ typography: "s2", fontWeight: 700, flexShrink: 0 }}>Watching production</Typography>
        <Typography noWrap sx={{ typography: "s3", color: "text.subtitle", flex: 1, minWidth: 0 }}>
          {summary}
        </Typography>
        <Typography sx={{ typography: "s3", fontWeight: 700, color: "primary.main", flexShrink: 0 }}>View production →</Typography>
      </Stack>
    );
  }
  return (
    <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 2, px: 1.5, py: 1, borderRadius: 1.25, border: "1px dashed", borderColor: "divider" }}>
      <Iconify icon="solar:pulse-2-linear" width={16} sx={{ color: "text.subtitle", flexShrink: 0 }} />
      <Typography noWrap sx={{ typography: "s3", color: "text.secondary", flex: 1, minWidth: 0 }}>
        {"Real calls aren't watched — you only see what the simulations find. "}
        {observe.mode === "sdk" && observe.requested ? "Add the tracing snippet to start." : ""}
      </Typography>
      <TurnOnButton observe={observe} onTurnOn={onTurnOn} onSetUp={onSetUp} small />
    </Stack>
  );
}
ObservabilityStrip.propTypes = {
  agent: PropTypes.object, observe: PropTypes.object, summary: PropTypes.node, onOpen: PropTypes.func, onTurnOn: PropTypes.func, onSetUp: PropTypes.func,
};

/** The Production tab before anything is watched — what it would show, and the one step. */
export function ObservabilityEmpty({ agent, observe, onTurnOn, onSetUp }) {
  return (
    <Box sx={{ py: 5, px: 3, textAlign: "center", border: "1px solid", borderColor: "divider", borderRadius: 1.5 }}>
      <Iconify icon="solar:pulse-2-linear" width={28} sx={{ color: "text.disabled", mb: 1 }} />
      <Typography sx={{ typography: "s1", fontWeight: 700 }}>{`${agent.name}'s real calls aren't watched yet`}</Typography>
      <Typography sx={{ typography: "s2", color: "text.subtitle", maxWidth: 560, mx: "auto", mt: 0.5 }}>
        Once they are, this tab shows each version&apos;s eval scores in production next to its simulation scores — and every real call, in the same drawer as a simulated one.
      </Typography>
      <Box sx={{ mt: 2 }}>
        {observe.mode === "traceai"
          ? <Box sx={{ textAlign: "left", maxWidth: 720, mx: "auto" }}><AgentTracingCard agent={agent} /></Box>
          : <TurnOnButton observe={observe} onTurnOn={onTurnOn} onSetUp={onSetUp} />}
      </Box>
    </Box>
  );
}
ObservabilityEmpty.propTypes = { agent: PropTypes.object, observe: PropTypes.object, onTurnOn: PropTypes.func, onSetUp: PropTypes.func };

/** Connection — the setting itself: on or off, how, and where calls land. */
export function ObservabilityCard({ agent, observe, onToggle, keyEditor, bare = false }) {
  const [showSnippet, setShowSnippet] = useState(observe.mode === "sdk" && !observe.on && observe.requested);
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper", overflow: "hidden" }}>
      {!bare && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
          <Typography sx={{ typography: "s2", fontWeight: 700, flex: 1 }}>Production calls</Typography>
          {observe.on && <Typography sx={{ typography: "s3", color: "text.subtitle", fontWeight: 600 }}>Watching</Typography>}
        </Stack>
      )}
      <Box sx={{ px: 2, py: 1.5 }}>
        {observe.mode === "platform" && (
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box flex={1} minWidth={0}>
              <Typography sx={{ typography: "s2", fontWeight: 600 }}>Watch production calls</Typography>
              <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
                {observe.needsKey ? "Needs the API key — add it under How we reach it" : "Pulled through its API key into Observe"}
              </Typography>
            </Box>
            <Switch size="small" checked={observe.on} disabled={observe.needsKey && !observe.on} onChange={(e) => onToggle(e.target.checked)} />
          </Stack>
        )}
        {observe.mode === "traceai" && (observe.on
          ? <Typography sx={{ typography: "s2" }}>Traced with traceAI — added by pull request to the repository.</Typography>
          : <AgentTracingCard agent={agent} />)}
        {observe.mode === "sdk" && (
          observe.on ? (
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Typography sx={{ typography: "s2", flex: 1 }}>Traced with the traceAI snippet in the agent.</Typography>
              <Button size="small" onClick={() => onToggle(false)} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary" }}>Stop watching</Button>
            </Stack>
          ) : (
            <>
              <Typography sx={{ typography: "s3", color: "text.subtitle", mb: 1 }}>
                We only see this agent from the outside, so it sends its own traces. Add this where it starts up, deploy, then confirm.
              </Typography>
              {showSnippet ? (
                <Box component="pre" sx={{ m: 0, mb: 1.25, p: 1.25, borderRadius: 1, fontFamily: MONO, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", bgcolor: (t) => alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.05 : 0.04), border: "1px solid", borderColor: "divider" }}>
                  {snippetFor(observe.project)}
                </Box>
              ) : null}
              <Stack direction="row" spacing={1}>
                {!showSnippet && (
                  <Button size="small" variant="outlined" onClick={() => setShowSnippet(true)} sx={{ typography: "s3", fontWeight: 700, color: "text.primary", borderColor: "divider" }}>Show the snippet</Button>
                )}
                {showSnippet && (
                  <Button size="small" variant="contained" color="primary" onClick={() => onToggle(true)} sx={{ typography: "s3", fontWeight: 700 }}>I&apos;ve added it</Button>
                )}
              </Stack>
            </>
          )
        )}
        {keyEditor}
      </Box>
      <Box sx={{ px: 2, py: 1.25, borderTop: "1px solid", borderColor: "divider" }}>
        {observe.on ? (
          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
            {observe.since ? `Watching since ${ago(observe.since)} · lands in the project below` : "Watching · lands in the project below"}
            <InfoTip text="Also in Error Feed, and in Add scenarios → From production for every environment testing this agent." />
          </Typography>
        ) : (
          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
            Not watched — you only see what simulations find
            <InfoTip text={WHY} />
          </Typography>
        )}
      </Box>
    </Box>
  );
}
ObservabilityCard.propTypes = { agent: PropTypes.object, observe: PropTypes.object, onToggle: PropTypes.func, keyEditor: PropTypes.node, bare: PropTypes.bool };

function TurnOnButton({ observe, onTurnOn, onSetUp, small }) {
  const direct = observe.mode === "platform" && !observe.needsKey;
  return (
    <Button
      size="small" variant={small ? "outlined" : "contained"} color="primary"
      onClick={direct ? onTurnOn : onSetUp}
      startIcon={<Iconify icon="solar:pulse-2-linear" width={14} />}
      sx={{ typography: small ? "s3" : "s2", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0, ...(small && { color: "text.primary", borderColor: "divider" }) }}
    >
      {observe.mode === "platform"
        ? (observe.needsKey ? "Add the API key" : "Watch production calls")
        : "Set up tracing"}
    </Button>
  );
}
TurnOnButton.propTypes = { observe: PropTypes.object, onTurnOn: PropTypes.func, onSetUp: PropTypes.func, small: PropTypes.bool };
