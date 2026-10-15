import PropTypes from "prop-types";
import { useState } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { useConnectedAgents, useSimStore } from "../store";
import { agentNeedsRuntime, agentSourceOf } from "../_mock/agentRegistry";
import { needsLiveConsent } from "../_mock/rsiModel";
import { replicationOf } from "../_mock/replication";
import { projectsOfAgent } from "../_mock/projectLinks";
import { resolveObserve } from "../_mock/connectAgent";
import { ObserveProjectStep } from "./connect/ConnectAboutStep";
import { showsSetup, testedInLine } from "./agentViewUtils";

/**
 * Finish setting up — what connecting in one step left for later: the things
 * a run needs before it can start (where it runs, consent, an environment)
 * and the Observe project its production traces land in, chosen here — an
 * existing project, or a new one named after the agent. What we read and the
 * constraints are on their own tabs, not repeated here.
 *
 * Shown for an agent connected through the one-step connect, or any agent
 * not tested anywhere yet (`showsSetup`), until everything is done or it's
 * hidden.
 */
export default function AgentSetupCard({ agent, env, onTab, onBuild, onSaveValues }) {
  const { agents, state } = useConnectedAgents();
  const { dispatch } = useSimStore();
  /* The Observe project chooser, opened in place. */
  const [choosing, setChoosing] = useState(false);
  const [observeChoice, setObserveChoice] = useState(null);
  if (!showsSetup(agent)) return null;
  const v = agent.values || {};

  const source = agentSourceOf(agent);
  const readFrom = source.kind === "repo" ? "the code" : source.kind === "framework" ? "the adapter" : source.kind === "platform" ? source.label : null;
  const projects = projectsOfAgent(agent, state, agents);
  /* Settled only when someone chose it — or a platform's call logs decide it.
     A link made for them is a suggestion until it's confirmed here. */
  const observeSettled = projects.length > 0 && (!!v.observeChosenAt || (source.kind === "platform" && !!v.observability?.on));
  const saveObserve = () => {
    const chosen = resolveObserve(observeChoice, null, agent.name);
    dispatch({ type: "linkProjectAgent", project: chosen.id, agentKey: agent.key });
    setChoosing(false);
    onSaveValues({ observeChosenAt: new Date().toISOString() }, chosen.mode === "create" ? `Created ${chosen.id} — ${agent.name}'s traces land there.` : `Linked to ${chosen.id}.`);
  };
  const consent = needsLiveConsent(agent) && !replicationOf(agent, env).needsConsent;

  /* Each: done, what it is, why it matters, and the way to it. Needed ones gate a run. */
  const items = [
    agentNeedsRuntime(agent) && {
      id: "runtime",
      needed: true,
      done: false,
      title: "Say where it runs",
      body: "Simulations call the agent on every turn — add the address it's served at, or run it in our sandbox.",
      action: { label: "Add", onClick: () => onTab("connections") },
    },
    consent && {
      id: "consent",
      needed: true,
      done: false,
      title: "Agree to live test runs",
      body: "It runs in your account and its tools reach your real systems, so the first run waits for an OK.",
      action: { label: "Review and agree", onClick: () => onTab("connections") },
    },
    {
      id: "observe",
      done: observeSettled,
      title: observeSettled ? "Observe project" : "Choose its Observe project",
      body: observeSettled
        ? `${projects.map((p) => p.name).join(", ")} · its production traces land here, so Error Feed issues can be fixed`
        : projects.length
          ? `Suggested: ${projects[0].name}. Confirm it or pick another — Error Feed issues from it can be fixed.`
          : "Where its production traces land — an existing project, or a new one named after the agent. Error Feed issues from it can be fixed.",
      action: choosing ? null : { label: observeSettled ? "Change" : "Choose", onClick: () => { setObserveChoice(projects[0] ? { mode: "existing", id: projects[0].project } : null); setChoosing(true); } },
      panel: choosing && (
        <Box sx={{ pl: 4.25, pr: 2, pb: 1.5 }}>
          <ObserveProjectStep agentName={agent.name} agentKey={agent.key} value={observeChoice} onChange={setObserveChoice} />
          <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 1.25 }}>
            <Button size="small" onClick={() => setChoosing(false)} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary" }}>Cancel</Button>
            <Button size="small" variant="contained" color="primary" onClick={saveObserve} sx={{ typography: "s3", fontWeight: 700 }}>Save</Button>
          </Stack>
        </Box>
      ),
    },
    {
      id: "environment",
      needed: true,
      done: (agent.usedIn || []).length > 0,
      title: "Build environment",
      body: testedInLine(agent.usedIn)
        || "Simulated tools and data, scenarios and evaluations to run it against — runs and improvements happen there.",
      action: (agent.usedIn || []).length
        ? { label: "View", onClick: () => onTab("environments") }
        : onBuild ? { label: "Build environment", primary: true, onClick: () => onBuild() } : null,
    },
  ].filter(Boolean);

  const done = items.filter((i) => i.done).length + 1;
  const total = items.length + 1;
  if (done === total) return null;

  return (
    <Box sx={{ mb: 2, border: "1px solid", borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper", overflow: "hidden" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography sx={{ typography: "s1", fontWeight: 700 }}>Finish setting up</Typography>
        <Typography sx={{ typography: "s3", color: "text.subtitle", fontVariantNumeric: "tabular-nums" }}>{`${done} of ${total}`}</Typography>
        <Box flex={1} />
        <Button
          size="small"
          onClick={() => onSaveValues({ setupDismissedAt: new Date().toISOString() }, "Hidden — everything here is still on the agent's tabs.")}
          sx={{ typography: "s3", fontWeight: 600, color: "text.secondary", minWidth: 0 }}
        >
          Hide
        </Button>
      </Stack>

      <Row done title="Connected" body={`${agent.name} is in Agents — v1 ${readFrom ? `read from ${readFrom}` : "saved"}.`} />
      {items.map((i) => (
        <Row key={i.id} {...i} />
      ))}
    </Box>
  );
}

AgentSetupCard.propTypes = {
  agent: PropTypes.object,
  env: PropTypes.object,
  /* Opens one of the agent's tabs ("definition", "connections", "constraints"). */
  onTab: PropTypes.func.isRequired,
  onBuild: PropTypes.func,
  /* (valuesPatch, message) — the agent page's own save. */
  onSaveValues: PropTypes.func.isRequired,
};

function Row({ done, needed, title, body, action, secondary, panel }) {
  return (
    <Box sx={{ borderTop: "1px solid", borderColor: "divider", "&:nth-of-type(2)": { borderTop: "none" } }}>
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, py: 1.125 }}>
      <Iconify
        icon={done ? "solar:check-circle-bold" : "solar:circle-linear"}
        width={18}
        sx={{ color: done ? "text.secondary" : "text.disabled", flexShrink: 0 }}
      />
      <Box flex={1} minWidth={0}>
        <Stack direction="row" alignItems="baseline" spacing={0.75}>
          <Typography sx={{ typography: "s2", fontWeight: 600, color: done ? "text.secondary" : "text.primary" }}>{title}</Typography>
          {needed && !done && <Typography sx={{ typography: "s3", color: "text.subtitle" }}>· needed to run</Typography>}
        </Stack>
        <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{body}</Typography>
      </Box>
      {secondary && (
        <Button size="small" onClick={secondary.onClick} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", flexShrink: 0 }}>
          {secondary.label}
        </Button>
      )}
      {action && (
        <Button
          size="small"
          variant={action.primary ? "contained" : "outlined"}
          color={action.primary ? "primary" : "inherit"}
          onClick={action.onClick}
          sx={{ typography: "s3", fontWeight: 700, height: 28, flexShrink: 0, ...(!action.primary && { color: "text.primary", borderColor: "divider" }) }}
        >
          {action.label}
        </Button>
      )}
    </Stack>
    {panel}
    </Box>
  );
}
Row.propTypes = {
  done: PropTypes.bool,
  needed: PropTypes.bool,
  title: PropTypes.string,
  body: PropTypes.node,
  action: PropTypes.object,
  secondary: PropTypes.oneOfType([PropTypes.object, PropTypes.bool]),
  panel: PropTypes.node,
};
