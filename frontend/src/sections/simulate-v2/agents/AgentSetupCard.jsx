import PropTypes from "prop-types";
import { useState } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { useConnectedAgents, useSimStore } from "../store";
import { PROVIDER_LABELS, agentNeedsRuntime, agentSourceOf } from "../_mock/agentRegistry";
import { needsLiveConsent, platformTestingOf } from "../_mock/rsiModel";
import { elevenlabsVersioningOn } from "../_mock/improvementPolicy";
import { replicationOf } from "../_mock/replication";
import { observeProjectOf } from "./observeProject";
import { resolveObserve } from "../_mock/connectAgent";
import { ObserveProjectStep } from "./connect/ConnectAboutStep";
import { showsSetup, testedInLine } from "./agentViewUtils";
import AgentFoundReview from "./AgentFoundReview";
import { isCodeAgent, needsFoundCheck } from "./foundFacts";

/**
 * Finish setting up — what connecting in one step left for later: the things
 * a run needs before it can start (where it runs, consent, an environment),
 * what we read from a code agent to confirm or correct (Flow 1, step 3), and
 * the Observe project its production traces land in, chosen here — an
 * existing project, or a new one named after the agent. The constraints
 * start at safe defaults; this says so and links to their tab.
 *
 * Shown for an agent connected through the one-step connect, or any agent
 * not tested anywhere yet (`showsSetup`), until everything is done or it's
 * hidden. A code agent's "Check what we found" is needed before it runs or
 * is improved, so the card can't be hidden while it's open.
 */
export default function AgentSetupCard({ agent, env, onTab, onBuild, onSaveValues }) {
  const { agents, state } = useConnectedAgents();
  /* Set on the Constraints tab, or still the safe defaults. */
  const customLimits = !!state?.agentLimits?.[agent?.key];
  const { dispatch } = useSimStore();
  /* The Observe project chooser, opened in place. */
  const [choosing, setChoosing] = useState(false);
  const [observeChoice, setObserveChoice] = useState(null);
  /* "Check what we found", opened in place. */
  const [reviewing, setReviewing] = useState(false);
  if (!showsSetup(agent)) return null;
  const v = agent.values || {};

  const source = agentSourceOf(agent);
  const readFrom = source.kind === "repo" ? "the code" : source.kind === "framework" ? "the adapter" : source.kind === "platform" ? source.label : null;
  /* One Observe project per agent. */
  const one = observeProjectOf(agent, state, agents);
  const projects = one ? [one] : [];
  /* Settled only when someone chose it — or a platform's call logs decide it.
     A link made for them is a suggestion until it's confirmed here. */
  const observeSettled = projects.length > 0 && (!!v.observeChosenAt || (source.kind === "platform" && !!v.observability?.on));
  const saveObserve = () => {
    const chosen = resolveObserve(observeChoice, null, agent.name);
    /* One Observe project per agent — a new choice replaces the old link. */
    Object.entries(state?.projectLinks || {})
      .filter(([p, k]) => k === agent.key && p !== chosen.id)
      .forEach(([p]) => dispatch({ type: "linkProjectAgent", project: p, agentKey: null }));
    dispatch({ type: "linkProjectAgent", project: chosen.id, agentKey: agent.key });
    setChoosing(false);
    onSaveValues({ observeChosenAt: new Date().toISOString() }, chosen.mode === "create" ? `Created ${chosen.id} — ${agent.name}'s traces land there.` : `Linked to ${chosen.id}.`);
  };
  const consent = needsLiveConsent(agent) && !replicationOf(agent, env).needsConsent;

  /* Each: done, what it is, why it matters, and the way to it. Needed ones gate a run. */
  const foundChecked = !!v.foundCheckedAt;
  /* Needed before it runs or is improved — the card stays until it's done. */
  const foundNeeded = needsFoundCheck(agent);
  const items = [
    isCodeAgent(agent) && {
      id: "found",
      needed: foundNeeded,
      done: foundChecked && !reviewing,
      title: "Check what we found",
      body: foundChecked
        ? "Entry point, prompts, tools, model, how to run it and its tests — confirmed. Tools that must never run for real and test credentials are on the record."
        : `What we read from ${readFrom || "the code"}: confirm or correct each item, including the tests every change must keep passing, say which tools must never run for real and which test credentials to use.`,
      action: reviewing ? null : { label: foundChecked ? "Review" : "Check", onClick: () => setReviewing(true) },
      panel: reviewing && (
        <Box sx={{ pl: 4.25, pr: 2, pb: 1.5 }}>
          <AgentFoundReview
            agent={agent}
            onCancel={() => setReviewing(false)}
            onSave={(patch, message) => { onSaveValues(patch, message); setReviewing(false); }}
          />
        </Box>
      ),
    },
    agentNeedsRuntime(agent) && {
      id: "runtime",
      needed: true,
      done: false,
      title: "Say where it runs",
      body: "Simulations call the agent on every turn — add the address our adapter's serve() answers on.",
      action: { label: "Add", onClick: () => onTab("connections") },
    },
    consent && {
      id: "consent",
      needed: true,
      done: false,
      /* Plain words: what testing does for real, and what's being asked. */
      title: "Allow test calls",
      body: `Tests call your real ${PROVIDER_LABELS[agent.values?.provider] ? `${PROVIDER_LABELS[agent.values.provider]} ` : ""}agent, so anything it does — like issuing a refund — really happens. Approve this once before the first run.`,
      action: { label: "Review", onClick: () => onTab("connections") },
    },
    /* ElevenLabs: changes ship as a branch, which needs versioning on — the
       person switches it on in ElevenLabs. Runs don't wait for it. */
    platformTestingOf(agent)?.needsVersioning && {
      id: "versioning",
      done: elevenlabsVersioningOn(agent) || !!v.versioningOnAt,
      title: "Switch versioning on",
      body: elevenlabsVersioningOn(agent) || v.versioningOnAt
        ? "On — improvements can ship their change as a branch."
        : `In ${PROVIDER_LABELS[v.provider] || "the platform"}: Agent → Settings → Versioning. It can't be undone. Until then, tests run but a change can't ship as a branch.`,
      action: elevenlabsVersioningOn(agent) || v.versioningOnAt ? null : {
        label: "It's on",
        onClick: () => {
          const at = new Date().toISOString();
          onSaveValues({ versioningOnAt: at, versioning: { at } }, "Versioning recorded as on — changes can ship as a branch.");
        },
      },
    },
    {
      id: "observe",
      done: observeSettled,
      title: observeSettled ? "Observe project" : "Choose its Observe project",
      body: observeSettled
        ? `${projects[0].name} · its traces or call logs land here, so Error Feed issues can be fixed`
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
    /* New agents start at safe defaults — said here, set on their own tab. */
    {
      id: "constraints",
      done: true,
      title: "Constraints",
      body: customLimits
        ? "Set on the Constraints tab — every improvement for this agent is held to them."
        : "Safe defaults applied — prompts and tool descriptions only, model locked, no cost increase.",
      action: { label: "Review", onClick: () => onTab("constraints") },
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
        {!foundNeeded && (
          <Button
            size="small"
            onClick={() => onSaveValues({ setupDismissedAt: new Date().toISOString() }, "Hidden — everything here is still on the agent's tabs.")}
            sx={{ typography: "s3", fontWeight: 600, color: "text.secondary", minWidth: 0 }}
          >
            Hide
          </Button>
        )}
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
