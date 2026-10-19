import PropTypes from "prop-types";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSnackbar } from "notistack";
import { Box, Button, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { nextSnapshotLabel } from "../_mock/envSnapshot";
import { agentVersions, isPendingDraft, pendingEnvChanges, productionAgentVersion } from "../_mock/versions";
import {
  rebuildEnvironmentPatch, rebuildScenariosPatch, reopenCardPatch, reopenScenariosPatch, scenarioStepOf,
  skipCardPatch, skipScenariosPatch, versionCardOf,
} from "../_mock/versionCard";
import { plural } from "../_mock/nudgeEffects";
import { paths } from "src/routes/paths";
import { useConnectedAgents } from "../store";
import { envAgentKey } from "../_mock/agentRegistry";
import { buildPresetFor } from "../agents/agentViewUtils";
import BuildEnvironmentDialog from "../agents/BuildEnvironmentDialog";

const MONO = "ui-monospace, Menlo, monospace";
const MAX_CHANGES = 5;
const head = { typography: "s3", fontWeight: 700, color: "text.subtitle", textTransform: "uppercase", letterSpacing: 0.5 };
const btn = { typography: "s2", fontWeight: 700, flexShrink: 0 };

/*
  The one card a new agent version raises here (see _mock/versionCard.js):
  what changed in the agent, the capability changes one Rebuild applies as a
  single environment version, and the rule changes that each need an answer.
  `renderNudge` draws a rule's own question — passed in so this file doesn't
  import NudgeCard (which renders this card).
*/
/* When the removed tools take at least this share of the scenarios with them,
   the agent looks like a different one — offer a new environment instead. */
const DIFFERENT_AGENT_SHARE = 0.5;
/* The scenario count a new environment starts with — the build screen's default. */
const NEW_ENV_SCENARIOS = 10;

export default function AgentVersionCard({ env, envState, patch, renderNudge }) {
  const { enqueueSnackbar } = useSnackbar();
  const [keepHere, setKeepHere] = useState(false);
  const card = versionCardOf(envState);
  if (!card) return null;
  /* Backward compatible? Update this environment. If most scenarios can't
     apply any more, say so and offer a new environment — built for you, or
     on your own. */
  const active = (envState?.scenarios || []).filter((r) => !r.archived && !r.retired).length;
  const lost = new Set(card.removals.flatMap((n) => n.scenarioIds || [])).size;
  const different = !keepHere && card.status === "open" && active > 0 && lost / active >= DIFFERENT_AGENT_SHARE;
  const nextLabel = nextSnapshotLabel(env, envState);
  const waiting = pendingEnvChanges(envState).length;

  if (card.status === "skipped") {
    return (
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2.5, py: 1.25 }}>
        <Iconify icon="solar:minus-circle-linear" width={16} sx={{ color: "text.subtitle", flexShrink: 0 }} />
        <Typography sx={{ typography: "s2", color: "text.secondary", flex: 1, minWidth: 0 }}>
          {`Agent ${card.newest}'s changes were skipped — the environment stays as it is. A newer version brings them back.`}
        </Typography>
        {patch && <Button size="small" variant="outlined" onClick={() => patch(reopenCardPatch(envState))} sx={{ ...btn, color: "text.primary", borderColor: "divider" }}>Review again</Button>}
      </Stack>
    );
  }

  const rebuild = () => {
    const out = rebuildEnvironmentPatch(env, envState, card);
    if (!out) return;
    patch(out.patch);
    enqueueSnackbar(`Environment ${nextLabel} — ${out.summary}${out.alsoSaved ? `, with your ${plural(out.alsoSaved, "unsaved edit")}` : ""}. Roll back from History if it isn't right.`, { variant: "success" });
  };
  const skip = () => {
    patch(skipCardPatch(envState, card));
    enqueueSnackbar(`Skipped agent ${card.newest}'s changes — the environment stays as it is.`, { variant: "info" });
  };
  const shownChanges = card.changes.slice(0, MAX_CHANGES);
  const canRebuild = card.capabilities.length > 0;

  return (
    <Box sx={{ px: 2.5, py: 1.75 }}>
      {/* What changed, and the two ways out. */}
      <Stack direction="row" alignItems="flex-start" spacing={1.5}>
        <Iconify icon="solar:refresh-circle-linear" width={18} sx={{ color: "text.secondary", flexShrink: 0, mt: 0.25 }} />
        <Box flex={1} minWidth={0}>
          <Typography sx={{ typography: "s1", fontWeight: 700 }}>
            {`Agent ${card.newest} changed`}
            {card.from && <Box component="span" sx={{ color: "text.subtitle", fontWeight: 500 }}>{` · since ${card.from}${card.versions.length > 1 ? `, ${card.versions.length} versions` : ""}`}</Box>}
          </Typography>
          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
            {canRebuild
              ? `Rebuild updates the world to match, as environment ${nextLabel}${waiting ? ` — your ${plural(waiting, "unsaved edit")} ${waiting === 1 ? "is" : "are"} saved with it` : ""}. Rules the tests check never change on their own.`
              : card.rules.length
                ? "Nothing in the world needs to change. Answer the rule changes below."
                : "Nothing in the world needs to change."}
          </Typography>
        </Box>
        {patch && (
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button size="small" onClick={skip} sx={{ ...btn, color: "text.secondary" }}>Skip</Button>
            {canRebuild && (
              <Button size="small" variant="contained" color="primary" onClick={rebuild} sx={btn}>Rebuild environment</Button>
            )}
          </Stack>
        )}
      </Stack>

      <Stack spacing={1.5} sx={{ mt: 1.5, pl: 4.25 }}>
        {different && (
          <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, px: 1.75, py: 1.25 }}>
            <Typography sx={{ typography: "s2", fontWeight: 600 }}>
              {`This looks like a different agent — ${lost} of ${active} scenarios need tools ${card.newest} no longer has.`}
            </Typography>
            <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>
              A new environment fits it better. This one stays as it is, with its runs.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <NewEnvironmentActions env={env} envState={envState} version={card.newest} />
              <Button size="small" onClick={() => setKeepHere(true)} sx={{ ...btn, color: "text.secondary" }}>Keep updating this one</Button>
            </Stack>
          </Box>
        )}
        {shownChanges.length > 0 && (
          <Box>
            <Typography sx={{ ...head, mb: 0.5 }}>In the agent</Typography>
            <Stack spacing={0.25}>
              {shownChanges.map((c, i) => (
                <Typography key={`${c.version}-${i}`} noWrap sx={{ typography: "s2", color: "text.secondary" }}>
                  {c.title}
                  {card.versions.length > 1 && <Box component="span" sx={{ color: "text.subtitle" }}>{` · ${c.version}`}</Box>}
                </Typography>
              ))}
              {card.changes.length > MAX_CHANGES && (
                <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{`+${card.changes.length - MAX_CHANGES} more`}</Typography>
              )}
            </Stack>
          </Box>
        )}

        {card.capabilities.length > 0 && (
          <Box>
            <Typography sx={{ ...head, mb: 0.5 }}>{`World · ${card.capabilities.length}`}</Typography>
            <Stack spacing={0.25}>
              {card.capabilities.map((n) => (
                <Typography key={n.id} noWrap sx={{ typography: "s2" }}>
                  <Box component="span" sx={{ color: "text.subtitle", mr: 0.75 }}>{n.kind === "add" ? "+" : "~"}</Box>
                  <Box component="span" sx={{ fontFamily: MONO }}>{n.capability}</Box>
                  <Box component="span" sx={{ color: "text.secondary" }}>{n.kind === "add" ? " — the world gets a handler for it" : " — its handler follows the new behaviour"}</Box>
                </Typography>
              ))}
            </Stack>
          </Box>
        )}

        {card.rules.length > 0 && (
          <Box>
            <Typography sx={{ ...head, mb: 0.25 }}>{`Rules · ${card.rules.length}`}</Typography>
            <Typography sx={{ typography: "s3", color: "text.subtitle", mb: 0.75 }}>
              {"Is each a policy change, or a regression? The test only changes if you say it's policy."}
            </Typography>
            <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, "& > * + *": { borderTop: "1px solid", borderColor: "divider" } }}>
              {card.rules.map((n, i) => <Box key={n.id}>{renderNudge(n, i === 0)}</Box>)}
            </Box>
          </Box>
        )}

        {card.removals.length > 0 && (
          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
            {`${card.removals.map((n) => n.capability).join(", ")} ${card.removals.length === 1 ? "was" : "were"} removed — the scenarios that need ${card.removals.length === 1 ? "it" : "them"} are handled in the scenario step below.`}
          </Typography>
        )}

        {card.other.map((n) => <Box key={n.id}>{renderNudge(n, false)}</Box>)}
      </Stack>
    </Box>
  );
}
AgentVersionCard.propTypes = {
  env: PropTypes.object.isRequired, envState: PropTypes.object.isRequired, patch: PropTypes.func, renderNudge: PropTypes.func.isRequired,
};

/* The second step: scenarios for what the environment now has. */
export function ScenarioStepCard({ env, envState, patch }) {
  const { enqueueSnackbar } = useSnackbar();
  const step = scenarioStepOf(envState);
  if (!step) return null;

  if (step.status === "skipped") {
    return (
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2.5, py: 1.25 }}>
        <Iconify icon="solar:minus-circle-linear" width={16} sx={{ color: "text.subtitle", flexShrink: 0 }} />
        <Typography sx={{ typography: "s2", color: "text.secondary", flex: 1, minWidth: 0 }}>
          The scenario update was skipped — the scenario set stays as it is.
        </Typography>
        {patch && <Button size="small" variant="outlined" onClick={() => patch(reopenScenariosPatch(envState))} sx={{ ...btn, color: "text.primary", borderColor: "divider" }}>Review again</Button>}
      </Stack>
    );
  }

  const rebuild = () => {
    const out = rebuildScenariosPatch(env, envState, step);
    patch(out.patch);
    enqueueSnackbar(
      [out.added && `${plural(out.added, "new scenario")}`, out.stale && `${plural(out.stale, "scenario")} stale`].filter(Boolean).join(" · ") || "Scenario set updated",
      { variant: "success" },
    );
  };

  return (
    <Box sx={{ px: 2.5, py: 1.75 }}>
      <Stack direction="row" alignItems="flex-start" spacing={1.5}>
        <Iconify icon="solar:list-check-linear" width={18} sx={{ color: "text.secondary", flexShrink: 0, mt: 0.25 }} />
        <Box flex={1} minWidth={0}>
          <Typography sx={{ typography: "s1", fontWeight: 700 }}>Update the scenarios</Typography>
          <Stack spacing={0.25} sx={{ mt: 0.25 }}>
            {step.adds.length > 0 && (
              <Typography sx={{ typography: "s2", color: "text.secondary" }}>
                {`${plural(step.newRows, "new scenario")} for `}
                <Box component="span" sx={{ fontFamily: MONO }}>{step.adds.map((a) => a.tool).join(", ")}</Box>
                {step.price && <Box component="span" sx={{ color: "text.subtitle" }}>{` · ${step.price.line}`}</Box>}
              </Typography>
            )}
            {step.removals.length > 0 && (
              <Typography sx={{ typography: "s2", color: "text.secondary" }}>
                {`${plural(step.staleRows, "scenario")} stale — ${step.staleRows === 1 ? "it needs" : "they need"} `}
                <Box component="span" sx={{ fontFamily: MONO }}>{step.removals.map((n) => n.capability).join(", ")}</Box>
                {". They still run, but count toward no decision until you update or archive them."}
              </Typography>
            )}
          </Stack>
        </Box>
        {patch && (
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button size="small" onClick={() => patch(skipScenariosPatch(envState))} sx={{ ...btn, color: "text.secondary" }}>Skip</Button>
            <Button size="small" variant="contained" color="primary" onClick={rebuild} sx={btn}>Rebuild scenarios</Button>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
ScenarioStepCard.propTypes = { env: PropTypes.object.isRequired, envState: PropTypes.object.isRequired, patch: PropTypes.func };

/*
  A change too big for this environment: "Create a new environment for me"
  builds one straight away (or runs `onForMe` when the caller has its own way,
  like a fork), and "I'll do it" opens the normal build dialog for the agent —
  name, version, how many scenarios. The agent comes from Agents, else from
  this environment's own copy of it, so neither button goes missing. A draft
  is never what a new environment tests: it starts from production.
*/
export function NewEnvironmentActions({ env, envState, version, onForMe, forMeContained = false }) {
  const navigate = useNavigate();
  const { agents } = useConnectedAgents();
  const [open, setOpen] = useState(false);
  const key = envAgentKey(envState?.agent, env.id);
  const production = productionAgentVersion(envState)?.label;
  const record = agents.find((a) => a.key === key) || (envState?.agent ? {
    ...envState.agent,
    key,
    name: envState.agent.name || `${env.name} agent`,
    versions: agentVersions(envState).map((v) => ({ ...v, pendingDraft: isPendingDraft(envState, v.label) })),
    latest: version,
    production,
  } : null);
  const tested = version && !isPendingDraft(envState, version) ? version : production;
  const build = (choice) => record && navigate(paths.dashboard.simulate.environmentBuild, {
    state: { presetSource: buildPresetFor(record, choice) },
  });
  const forMe = onForMe || (() => build({ version: tested, count: NEW_ENV_SCENARIOS, name: `${env.name} · ${tested}` }));
  const doIt = () => (record ? setOpen(true) : navigate(paths.dashboard.simulate.environmentNew));
  return (
    <>
      <Button size="small" variant="outlined" onClick={doIt} sx={{ ...btn, color: "text.primary", borderColor: "divider" }}>
        I&apos;ll do it
      </Button>
      <Button
        size="small"
        variant={forMeContained ? "contained" : "outlined"}
        color="primary"
        onClick={forMe}
        disabled={!onForMe && !record}
        sx={forMeContained ? btn : { ...btn, color: "text.primary", borderColor: "divider" }}
      >
        Create a new environment for me
      </Button>
      {record && (
        <BuildEnvironmentDialog
          open={open}
          onClose={() => setOpen(false)}
          agent={record}
          defaultVersion={tested}
          channel={env?.surface || null}
          onBuild={(choice) => { setOpen(false); build(choice); }}
        />
      )}
    </>
  );
}
NewEnvironmentActions.propTypes = {
  env: PropTypes.object.isRequired,
  envState: PropTypes.object,
  version: PropTypes.string,
  onForMe: PropTypes.func,
  forMeContained: PropTypes.bool,
};
