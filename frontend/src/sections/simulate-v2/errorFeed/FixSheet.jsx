import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Checkbox, CircularProgress, IconButton, InputBase, MenuItem, Select, Stack, Switch, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { paths } from "src/routes/paths";
import SideDrawer from "../components/SideDrawer";
import { agentSourceOf, agentDefinitionOf } from "../_mock/agentRegistry";
import { agentVersions, currentAgentVersion } from "../_mock/versions";
import { currentEnvSnapshot } from "../_mock/envSnapshot";
import { DEFAULT_LIMITS, limitRows } from "../_mock/optimizationRuns";
import { useAgentImprovementFlag } from "../_mock/featureFlags";
import BuildEnvironmentDialog from "../agents/BuildEnvironmentDialog";
import { buildPresetFor } from "../agents/agentViewUtils";
import { budgetsWithin } from "../_mock/improvementStart";
import { limitsOf } from "../agents/agentLimits";
import { projectLinkOf } from "../_mock/projectLinks";
import { targetableMembers, membersOf, isProtectedMember, textSearchDefault } from "../_mock/improvementPolicy";
import ConnectAgentDialog from "./ConnectAgentDialog";
import { clickable, focusRing } from "../components/clickable";
import {
  FIX_IN_FLIGHT, envsForAgent, fixEstimate, fixPreview, issueFixNav, issueProjectLinkOf, issueScenarioDrafts, productionVersionOf, useIssueFix,
} from "./issueFix";
import { creditsForUsd, creditsLabel } from "../_mock/metering";
import { useSimStore, useConnectedAgents } from "../store";
import { LiveConsentCard } from "../agents/AgentLiveConsent";

/* The time budgets a fix can take — never more than the agent's own. */
const MINUTES = [15, 30, 45, 60, 90, 120];
const minutesWithin = (ceiling) => {
  const list = MINUTES.filter((m) => m <= ceiling);
  return list.length ? list : [ceiling];
};

const label = { typography: "s3", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, mb: 0.75 };
const rowSx = (on) => ({
  px: 1.5, py: 1, borderRadius: 1, border: "1px solid",
  borderColor: on ? "text.primary" : "divider",
  bgcolor: (t) => (on ? alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.05 : 0.025) : "transparent"),
});

/**
 * Fix — the sheet that starts an improvement run from an Error Feed issue
 * (RSI PRD, Flow 3). Everything arrives filled in: the agent and the version
 * running in production, the scenarios built from the issue's traces (edit
 * or drop any), the environment — the agent's main one, whose must-pass set
 * is the regression check — the constraints from the agent, and a budget
 * with a low, likely and high estimate. Future AGI's engine does the search;
 * a coding agent comes in through Copy for coding agent instead (Flow 6).
 *
 * The sheet checks for itself what the Fix button checks, so every way in
 * (the button, Prove it before it ships, Fix again on a reopened issue) is
 * held to the same rules: a fix already in flight opens that fix, an issue
 * no agent is linked to connects one, and Start waits for a confirmed issue
 * and the agent's production traces.
 */
/* Preparing a fix plan takes a moment: the issue's traces are read, the
   agent and its production version found, where to test it settled, the
   scenarios written from the traces (RSI PRD: "the issue's conversations,
   turned into scenarios with an inferred persona and a sub-goal for the
   failing step") and the agent's limits applied. The fix itself — the
   candidate changes — is drafted after Start, in the search. Done once per
   issue in a session: reopening Fix shows the plan at once. */
const PREPARED = new Set();
const PREP_STEPS = [
  { id: "issue", label: "Reading the issue", ms: 700 },
  { id: "agent", label: "Finding the agent and its version in production", ms: 600 },
  { id: "env", label: "Finding the agent's environment", ms: 600 },
  { id: "scenarios", label: "Writing scenarios from the traces", ms: 1100 },
  { id: "limits", label: "Applying the agent's limits", ms: 500 },
];

export default function FixSheet({ open, onClose, issue, rootCause = null }) {
  const navigate = useNavigate();
  const improving = useAgentImprovementFlag();
  const { state, agent, agents, project, gate, start, evidence, status } = useIssueFix(issue);
  /* A fix runs in the agent's main environment — never one picked per fix.
     Its other environments can add their must-pass sets (RSI PRD: "Targets
     come from one environment; the others add their must-pass sets"). */
  const envs = useMemo(() => envsForAgent(agent, state), [agent, state]);
  const main = envs[0] || null;
  const others = envs.slice(1);
  const [alsoIn, setAlsoIn] = useState([]);
  /* Search across the lineage: changes earlier versions made, tried again. */
  const [acrossLineage, setAcrossLineage] = useState(false);
  const mustPassIn = (e) => (state.byEnv[e.id]?.scenarios || []).filter((r) => !r.archived && !r.retired && (r.critical || r.regressionMemory)).length;
  const inFlight = !!agent && !!status && FIX_IN_FLIGHT.has(status.key);
  const [connecting, setConnecting] = useState(false);
  const mainState = main ? state.byEnv[main.id] : null;
  const [target, setTarget] = useState("");
  const [textSearch, setTextSearch] = useState(null);
  const [buildOpen, setBuildOpen] = useState(false);
  /* Live-test consent is asked here, where it's needed — not a dead end on
     the button. Nothing runs (the baseline, the fix) until it's given, and
     once given it stays on screen as "Given just now". */
  const { setAgentValues } = useConnectedAgents();
  const consentNeeded = gate?.key === "consent";
  const hardGate = gate && !consentNeeded ? gate : null;
  const [askedConsent, setAskedConsent] = useState(false);
  useEffect(() => { if (consentNeeded) setAskedConsent(true); }, [consentNeeded]);

  /* ── nowhere to start from yet ──
     A fix runs in the agent's main environment, and its first step measures
     today there (RSI PRD: "Measure today … sets the baseline") — so an
     environment is all it needs; nobody runs it by hand first. With none,
     Fix hands over to the normal environment flow — the same build dialog
     and builder the agent page uses — and the environment remembers this
     issue (returnToIssue) to bring the person back here once it's built.
     One way to build an environment, never a second one inside Fix. */
  const { commit } = useSimStore();
  const needsEnv = !!agent && !inFlight && !main;
  /* Still building: the fix starts once it's done. */
  const building = !!agent && !inFlight && main?.buildStatus === "building";
  /* Everything the fix needs is in place — otherwise the sheet still shows
     the whole plan, with the missing piece in Environment and its button. */
  const ready = !!main && !building;
  /* The plan's scenarios, being written: index of the step in progress. */
  const prepSteps = PREP_STEPS;
  const [prep, setPrep] = useState(() => (PREPARED.has(issue?.cluster_id) ? prepSteps.length : 0));
  const prepared = prep >= prepSteps.length;
  useEffect(() => {
    if (!open || !issue?.cluster_id) return undefined;
    if (PREPARED.has(issue.cluster_id)) { setPrep(prepSteps.length); return undefined; }
    setPrep(0);
    const timers = [];
    let at = 0;
    prepSteps.forEach((step, i) => {
      at += step.ms;
      timers.push(setTimeout(() => {
        if (i === prepSteps.length - 1) PREPARED.add(issue.cluster_id);
        setPrep(i + 1);
      }, at));
    });
    return () => timers.forEach(clearTimeout);
  }, [open, issue?.cluster_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const openBuilding = () => {
    /* Watched from its page; the banner there brings the person back. */
    if (main.returnToIssue !== issue?.cluster_id) {
      commit({ type: "patchEnvironment", envId: main.id, patch: { returnToIssue: issue?.cluster_id || null, returnFrom: "opened", returnSince: new Date().toISOString() } });
    }
    onClose();
    navigate(paths.dashboard.simulate.environmentDetail(main.id));
  };

  /* Built from the issue's traces — shown even before there's an environment. */
  const drafts = useMemo(() => (issue ? issueScenarioDrafts(issue, main, mainState) : []), [issue, main, mainState]);
  const [picked, setPicked] = useState({});
  const [titles, setTitles] = useState({});
  const [budget, setBudget] = useState(null);
  const [minutes, setMinutes] = useState(null);
  /* The issue's project — the agent below is the one it was set up with. */
  const projectName = projectLinkOf(project, state, agents).name;

  useEffect(() => {
    if (!open) return;
    setPicked(Object.fromEntries(drafts.map((d) => [d.id, true])));
    setTitles({});
    setBudget(null);
    setMinutes(null);
    setAlsoIn([]);
    setAcrossLineage(false);
  }, [open, drafts, main]);
  useEffect(() => {
    if (!open) return;
    setTarget("");
    setTextSearch(null);
    setAskedConsent(consentNeeded);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  /* A voice agent searches in text by default; finalists run as real calls. */
  const inText = main?.surface === "voice" && (textSearch ?? textSearchDefault(main?.surface));

  const chosen = drafts.filter((d) => picked[d.id]).map((d) => ({ ...d, title: titles[d.id]?.trim() || d.title }));
  /* The search this fix will run, worked out now — so the range is real. */
  /* The agent's constraints decide what the search may try and what it may spend. */
  const limits = useMemo(() => limitsOf(state, agent?.key), [state, agent]);
  const preview = useMemo(() => fixPreview(main, mainState, issue, drafts, limits, { textSearch: inText }), [main, mainState, issue, drafts, limits, inText]);
  /* Members: one can be targeted; protected ones are never changed. */
  const members = membersOf(agent);
  const targetable = targetableMembers(agent, limits);
  /* Each extra environment runs its must-pass set for the finalists. */
  const regressionCount = others.filter((e) => alsoIn.includes(e.id)).reduce((n, e) => n + mustPassIn(e), 0);
  const estimate = fixEstimate({ preview, scenarioCount: chosen.length, regressionCount, surface: main?.surface });
  /* Up to the agent's run budget — never more. */
  const budgets = budgetsWithin(limits.budget.dollars);
  const spend = budget ?? budgets[budgets.length - 1];
  const overBudget = estimate.likely > spend;
  /* Minutes cap it the same way — the agent's time budget is the ceiling. */
  const minuteChoices = minutesWithin(limits.budget?.minutes || DEFAULT_LIMITS.budget.minutes);
  const spendMinutes = minutes ?? minuteChoices[minuteChoices.length - 1];
  const overTime = estimate.minutes > spendMinutes;

  /* What's in production: the latest release, else the version the issue's
     traces carry — or, honestly, just the current version. */
  const production = productionVersionOf(agent, state, issue, mainState);
  /* Earlier versions that changed something — what a lineage search offers again. */
  const lineageVersions = useMemo(() => {
    const list = agentVersions(mainState);
    const at = list.findIndex((v) => v.label === production.label);
    return (at > 0 ? list.slice(0, at) : []).filter((v) => (v.changes || []).length);
  }, [mainState, production.label]);
  const model = useMemo(() => {
    if (!agent || !main) return null;
    const def = agentDefinitionOf({ agent, env: main, envState: mainState });
    return def.model?.visible ? def.model.name : null;
  }, [agent, main, mainState]);
  const constraints = limitRows(limits, model);

  const go = () => {
    const at = start({
      env: main, drafts: chosen, regressionEnvIds: [main.id, ...alsoIn], budget: spend, minutes: spendMinutes,
      lineage: acrossLineage ? lineageVersions : undefined,
      textSearch: inText, targetMember: target || undefined, rootCause,
    });
    onClose();
    navigate(...issueFixNav(at, issue?.cluster_id));
  };

  const meta = [issue?.cluster_id, issue?.trace_count && `${issue.trace_count} traces`, issue?.severity].filter(Boolean).join(" · ");
  /* "agent v2 × environment v7" — what a regression environment would run:
     the version in production, the same one the Agent row names and the
     fix improves. */
  const pairOf = (e) => {
    const es = state.byEnv[e.id];
    const envLabel = currentEnvSnapshot(e, es)?.label;
    return `agent ${production.label || currentAgentVersion(es)?.label || "—"} × environment ${envLabel || "—"}`;
  };

  const gateNote = hardGate && (
    <Stack direction="row" spacing={1.25} sx={{ px: 1.5, py: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
      <Iconify icon="solar:lock-keyhole-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0, mt: "1px" }} />
      <Box flex={1} minWidth={0}>
        <Typography sx={{ typography: "s2", fontWeight: 600 }}>{hardGate.title}</Typography>
        <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>{hardGate.body}</Typography>
      </Box>
      {hardGate.action === "connections" && (
        <Button
          size="small" variant="outlined"
          onClick={() => { onClose(); navigate(`${paths.dashboard.agents}/connected/${agent.id}?tab=connections`); }}
          sx={{ typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider", flexShrink: 0, alignSelf: "center" }}
        >
          Open Connections
        </Button>
      )}
    </Stack>
  );
  const consentBlock = agent && (consentNeeded || askedConsent) && (
    <Box>
      <Typography sx={label}>Consent for live tests</Typography>
      <Box sx={{ px: 1.5, py: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
        <LiveConsentCard agent={agent} env={main} onSave={(values) => setAgentValues(agent.key, values)} bare />
      </Box>
    </Box>
  );

  if (!improving) return null;

  return (
    <SideDrawer open={open} onClose={onClose} width={600}>
      <Stack sx={{ height: "100%" }}>
        <Stack direction="row" alignItems="flex-start" spacing={2} sx={{ px: 2.5, py: 2, borderBottom: "1px solid", borderColor: "divider", flexShrink: 0 }}>
          <Box flex={1} minWidth={0}>
            <Typography sx={{ typography: "m2", fontWeight: 600 }}>Fix this issue</Typography>
            <Typography sx={{ typography: "s2", color: "text.secondary", mt: 0.25 }}>{issue?.error?.name}</Typography>
            <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>{meta}</Typography>
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Close">
            <Iconify icon="solar:close-circle-linear" width={18} sx={{ color: "text.subtitle" }} />
          </IconButton>
        </Stack>

        {/* ── no agent records this issue's project ── */}
        {!agent && (
          <>
            <Box sx={{ flex: 1, p: 2.5 }}>
              <Typography sx={{ typography: "s2", fontWeight: 600 }}>{`No agent is linked to ${projectName || "this issue's project"}`}</Typography>
              <Typography sx={{ typography: "s2", color: "text.secondary", mt: 0.5 }}>
                Fix proves a change on the agent that produced these traces. Connect it once — this project comes with it, and Fix works for every issue from it.
              </Typography>
            </Box>
            <Footer onClose={onClose}>
              <Button variant="contained" color="primary" size="small" onClick={() => setConnecting(true)} sx={{ typography: "s2", fontWeight: 700 }}>
                Connect agent to fix
              </Button>
            </Footer>
            <ConnectAgentDialog open={connecting} onClose={() => setConnecting(false)} issue={issue} project={issueProjectLinkOf(issue, state, agents).project} />
          </>
        )}

        {/* ── a fix is already in flight: open it, never start a second ── */}
        {inFlight && (
          <>
            <Box sx={{ flex: 1, p: 2.5 }}>
              <Typography sx={{ typography: "s2", fontWeight: 600 }}>{`This issue already has a fix · ${status.label}`}</Typography>
              <Typography sx={{ typography: "s2", color: "text.secondary", mt: 0.5 }}>
                An issue has one fix at a time. Open it to follow or review it; if it ends without fixing the issue, or the issue comes back after release, Fix again starts a new one.
              </Typography>
            </Box>
            <Footer onClose={onClose}>
              <Button variant="contained" color="primary" size="small" onClick={() => { onClose(); navigate(...issueFixNav(status, issue?.cluster_id)); }} sx={{ typography: "s2", fontWeight: 700 }}>
                View fix
              </Button>
            </Footer>
          </>
        )}

        {/* ── the fix: the whole plan, filled in. With no environment yet, or
            one still building, the plan still shows; Environment says what's
            missing and the button sets it up (the normal builder, then
            Continue fixing brings the person back to this sheet). ── */}
        {/* ── preparing the plan ── */}
        {agent && !inFlight && !prepared && (
          <>
            <Box sx={{ flex: 1, overflow: "auto", p: 2.5 }}>
              <Typography sx={{ typography: "s1", fontWeight: 600 }}>Preparing the fix plan</Typography>
              <Typography sx={{ typography: "s2", color: "text.secondary", mt: 0.5 }}>
                {"What the fix needs. The changes are drafted after you start."}
              </Typography>
              <Box sx={{ mt: 2, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                {prepSteps.map((step, i) => {
                  const detail = {
                    issue: `${issue?.trace_count || 0} traces · ${issue?.users_affected || 0} users`,
                    agent: `${agent.name} · ${production.label || "production"}`,
                    env: main
                      ? `${main.name} · ${ready ? "already built — the fix measures it on today's version first" : "still building"}`
                      : "None yet — you'll build one before the fix starts",
                    scenarios: `${drafts.length} situations · callers inferred · failing step marked`,
                    limits: [constraints.find((c) => c.id === "model")?.value, constraints.find((c) => c.id === "cost")?.value && `cost ${constraints.find((c) => c.id === "cost").value.toLowerCase()}`, `up to ${creditsLabel(spend)}`].filter(Boolean).join(" · "),
                  }[step.id];
                  return (
                    <Stack key={step.id} direction="row" alignItems="flex-start" spacing={1.25} sx={{ px: 1.5, py: 1.1, borderTop: i ? "1px solid" : "none", borderColor: "divider" }}>
                      <Box sx={{ width: 16, display: "grid", placeItems: "center", flexShrink: 0, mt: "2px" }}>
                        {i < prep ? (
                          <Iconify icon="solar:check-circle-linear" width={15} sx={{ color: "text.secondary" }} />
                        ) : i === prep ? (
                          <CircularProgress size={12} thickness={5} sx={{ color: "text.disabled" }} />
                        ) : (
                          <Box sx={{ width: 10, height: 10, borderRadius: "50%", border: "1px solid", borderColor: "divider" }} />
                        )}
                      </Box>
                      <Box flex={1} minWidth={0}>
                        <Typography sx={{ typography: "s2", color: i <= prep ? "text.primary" : "text.disabled" }}>{step.label}</Typography>
                        {i < prep && <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{detail}</Typography>}
                      </Box>
                    </Stack>
                  );
                })}
              </Box>
            </Box>
            <Footer onClose={onClose} note="Usually a few seconds." />
          </>
        )}

        {agent && !inFlight && prepared && (
          <>
            <Stack spacing={2.5} sx={{ flex: 1, overflow: "auto", p: 2.5 }}>
              {/* Built for this issue: the fix starts here now. */}
              {ready && main.returnToIssue && main.returnToIssue === issue?.cluster_id && (
                <Stack direction="row" spacing={1.25} sx={{ px: 1.5, py: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                  <Iconify icon="solar:check-circle-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0, mt: "1px" }} />
                  <Box flex={1} minWidth={0}>
                    <Typography sx={{ typography: "s2", fontWeight: 600 }}>{`${main.name} is built`}</Typography>
                    <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>
                      The fix runs its scenarios on today&apos;s version first. Those that pass every repeat, with any you mark must-pass, must keep passing.
                    </Typography>
                  </Box>
                </Stack>
              )}
              {/* Not confirmed yet: said, never blocking — reproducing is the check. */}
              {evidence && (
                <Stack direction="row" spacing={1.25} sx={{ px: 1.5, py: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                  <Iconify icon="solar:info-circle-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0, mt: "1px" }} />
                  <Box flex={1} minWidth={0}>
                    <Typography sx={{ typography: "s2", fontWeight: 600 }}>{evidence.title}</Typography>
                    <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>{evidence.body}</Typography>
                  </Box>
                </Stack>
              )}
              {gateNote}
              {consentBlock}
              {/* What we're fixing — the same root cause the issue page shows,
                  carried into the fix's snapshot. */}
              {rootCause && (
                <Box>
                  <Typography sx={label}>{"What we're fixing"}</Typography>
                  <Box sx={{ px: 1.5, py: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                    <Typography sx={{ typography: "s2" }}>{rootCause.headline}</Typography>
                    {rootCause.fix && (
                      <Typography sx={{ typography: "s3", color: "text.secondary", mt: 0.5 }}>{`Suggested fix · ${rootCause.fix}`}</Typography>
                    )}
                    <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.5 }}>
                      {rootCause.source === "analysis"
                        ? "From the Root cause tab."
                        : "The feed's first read. Find root cause gives a fuller one."}
                    </Typography>
                  </Box>
                </Box>
              )}

              <Box>
                <Stack direction="row" alignItems="baseline" justifyContent="space-between">
                  <Typography sx={label}>Agent</Typography>
                  {projectName && <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{`Linked to ${projectName}`}</Typography>}
                </Stack>
                <Stack direction="row" alignItems="center" spacing={1.25} sx={rowSx(false)}>
                  <Iconify icon={agentSourceOf(agent).icon} width={16} sx={{ color: "text.secondary", flexShrink: 0 }} />
                  <Box flex={1} minWidth={0}>
                    <Typography noWrap sx={{ typography: "s2", fontWeight: 600 }}>{agent.name}</Typography>
                    <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>{production.line}</Typography>
                  </Box>
                  <Button size="small" onClick={() => navigate(`${paths.dashboard.agents}/connected/${agent.id}`)} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary" }}>
                    View agent
                  </Button>
                </Stack>
              </Box>

              <Box>
                <Typography sx={label}>Environment</Typography>
                {!main && (
                  <>
                    <Stack direction="row" alignItems="center" spacing={1.25} sx={{ ...rowSx(false), borderStyle: "dashed" }}>
                      <Iconify icon="solar:box-minimalistic-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0 }} />
                      <Box flex={1} minWidth={0}>
                        <Typography noWrap sx={{ typography: "s2", fontWeight: 600 }}>Not set up yet</Typography>
                        <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>Where the fix is tried before anything ships</Typography>
                      </Box>
                    </Stack>
                    <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.75 }}>
                      {`Built from ${agent.name} — a few minutes. Then you come back here and start.`}
                    </Typography>
                  </>
                )}
                {main && (
                <Stack direction="row" alignItems="center" spacing={1.25} sx={rowSx(false)}>                  <Box flex={1} minWidth={0}>
                    <Typography noWrap sx={{ typography: "s2", fontWeight: 600 }}>{main.name}</Typography>
                    <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>
                      {ready ? "Main environment · where every fix for this agent runs" : "Main environment · still building"}
                    </Typography>
                  </Box>
                </Stack>
                )}
                {/* Its must-pass set is the regression check (three scenario sets). */}
                {main && (
                  <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.75 }}>
                    {ready
                      ? `${pairOf(main)} · measured on today's version first; a change that breaks what passes is rejected.`
                      : "The fix starts once it's built."}
                  </Typography>
                )}
                {/* The agent's other environments: their must-pass sets can join
                    the check — the candidate must pass every one. */}
                {ready && others.length > 0 && (
                  <Box sx={{ mt: 1.25 }}>
                    <Typography sx={{ typography: "s3", color: "text.subtitle", mb: 0.5 }}>Also check must-pass in</Typography>
                    <Stack spacing={0.25}>
                      {others.map((e) => {
                        const on = alsoIn.includes(e.id);
                        const n = mustPassIn(e);
                        return (
                          <Stack
                            key={e.id} direction="row" alignItems="center" spacing={1}
                            {...clickable(() => setAlsoIn((ids) => (on ? ids.filter((x) => x !== e.id) : [...ids, e.id])), { role: "checkbox", checked: on })}
                            sx={{ ...rowSx(on), cursor: "pointer", ...focusRing }}
                          >
                            <Iconify icon={on ? "solar:check-square-bold" : "solar:stop-linear"} width={16} sx={{ color: on ? "text.primary" : "text.subtitle", flexShrink: 0 }} />
                            <Typography noWrap sx={{ typography: "s2", flex: 1, minWidth: 0 }}>{e.name}</Typography>
                            <Typography noWrap sx={{ typography: "s3", color: "text.subtitle", fontVariantNumeric: "tabular-nums" }}>
                              {n ? `${n} must-pass · ${pairOf(e)}` : `No must-pass yet · ${pairOf(e)}`}
                            </Typography>
                          </Stack>
                        );
                      })}
                    </Stack>
                  </Box>
                )}
              </Box>

              {members.length > 0 && (
                <Box>
                  <Typography sx={label}>Target member</Typography>
                  <Select
                    size="small" fullWidth displayEmpty value={target} onChange={(e) => setTarget(e.target.value)}
                    sx={{ typography: "s2", "& .MuiSelect-select": { typography: "s2", py: 0.75 } }}
                  >
                    <MenuItem value="" sx={{ typography: "s2" }}>Any member the evidence points to</MenuItem>
                    {members.map((m) => (
                      <MenuItem key={m.id} value={m.name} disabled={isProtectedMember(m, limits)} sx={{ typography: "s2" }}>
                        {isProtectedMember(m, limits) ? `${m.name} · protected, never changed` : m.name}
                      </MenuItem>
                    ))}
                  </Select>
                  <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.75 }}>
                    {target
                      ? `Target member: ${target}. Changes stay inside it; parts every member shares are changed only when the fix needs them, and the proposal says so.`
                      : `Every proposal names the members it changes.${targetable.length < members.length ? " Protected members are never changed." : ""}`}
                  </Typography>
                </Box>
              )}

              <Box>
                <Typography sx={label}>{`Scenarios from this issue · ${chosen.length} of ${drafts.length}`}</Typography>
                <Stack spacing={0.75}>
                  {drafts.map((d) => (
                    <Stack key={d.id} direction="row" alignItems="flex-start" spacing={0.5} sx={rowSx(false)}>
                      <Checkbox
                        size="small" checked={!!picked[d.id]} disabled={!ready}
                        onChange={(e) => setPicked((p) => ({ ...p, [d.id]: e.target.checked }))}
                        sx={{ p: 0.25, mt: 0.125, ...(!ready && { "&.Mui-disabled": { color: "text.disabled" } }) }}
                      />
                      <Box flex={1} minWidth={0}>
                        {/* The title is the scenario — edit it in place. */}
                        <InputBase
                          fullWidth multiline value={titles[d.id] ?? d.title} readOnly={!ready}
                          onChange={(e) => setTitles((t) => ({ ...t, [d.id]: e.target.value }))}
                          sx={{ py: 0, color: picked[d.id] ? "text.primary" : "text.disabled", "& .MuiInputBase-input": { typography: "s2", p: 0 } }}
                        />
                        <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
                          {`From ${d.errorFeedIssue.traceIds.length} traces${d.persona?.archetype ? ` · ${d.persona.archetype}, inferred from the calls` : d.persona?.name ? ` · ${d.persona.name}` : ""}`}
                        </Typography>
                      </Box>
                    </Stack>
                  ))}
                </Stack>
                {drafts[0]?.subGoals?.[1] && (
                  <Typography sx={{ typography: "s3", color: "text.secondary", mt: 0.75 }}>
                    {`Each checks the step that failed: ${drafts[0].subGoals[1].replace(/^Verify the step that failed in production:\s*/i, "")}.`}
                  </Typography>
                )}
                <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.75 }}>
                  {ready
                    ? `Used by this fix only. Failing ones become targets; some are held back to prove the fix.`
                    : "Used by this fix only. You can edit them when you're back to start."}
                </Typography>
              </Box>

              <Box>
                <Stack direction="row" alignItems="baseline">
                  <Typography sx={{ ...label, flex: 1 }}>Constraints · from the agent</Typography>
                  <Typography
                    {...clickable(() => navigate(`${paths.dashboard.agents}/connected/${agent.id}?tab=constraints`))}
                    sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", cursor: "pointer", "&:hover": { color: "text.primary" }, ...focusRing }}
                  >
                    Change
                  </Typography>
                </Stack>
                <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                  {constraints.map((c, i) => (
                    <Stack key={c.id} direction="row" spacing={2} sx={{ px: 1.5, py: 0.875, borderTop: i ? "1px solid" : "none", borderColor: "divider" }}>
                      <Typography sx={{ typography: "s2", color: "text.subtitle", width: 170, flexShrink: 0 }}>{c.label}</Typography>
                      <Typography sx={{ typography: "s2" }}>{c.value}</Typography>
                    </Stack>
                  ))}
                </Box>
                <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.75 }}>
                  A change that breaks any of these is rejected.
                </Typography>
              </Box>

              {ready && main.surface === "voice" && (
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box flex={1} minWidth={0}>
                      <Typography sx={{ typography: "s2", fontWeight: 600 }}>Search in text, confirm finalists as real calls</Typography>
                      <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
                        {estimate.allCalls
                          ? `Runs happen as text conversations — about ${estimate.minutes} min and ${creditsLabel(estimate.likely)}, against ${estimate.allCalls.minutes} min and ${creditsLabel(estimate.allCalls.likely)} as real calls. Only the finalists are called.`
                          : "Every run is a real call — slower and dearer, and closest to production."}
                      </Typography>
                    </Box>
                    <Switch size="small" checked={inText} onChange={(e) => setTextSearch(e.target.checked)} />
                  </Stack>
                </Box>
              )}

              {/* Search across the lineage (RSI PRD): changes earlier versions
                  made, offered to the search again. */}
              {lineageVersions.length > 0 && (
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box flex={1} minWidth={0}>
                      <Typography sx={{ typography: "s2", fontWeight: 600 }}>Search across earlier versions</Typography>
                      <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
                        {`Also tries the changes ${lineageVersions[0].label}–${lineageVersions[lineageVersions.length - 1].label} made, on ${production.label}. Checked the same way as every other proposed change.`}
                      </Typography>
                    </Box>
                    <Switch size="small" checked={acrossLineage} onChange={(e) => setAcrossLineage(e.target.checked)} />
                  </Stack>
                </Box>
              )}

              {!ready && (
                <Box>
                  <Typography sx={label}>Budget</Typography>
                  <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                    <SpecRow k="Up to" first><Typography sx={{ typography: "s2" }}>{`${creditsLabel(spend)} · ${spendMinutes} min, from the agent`}</Typography></SpecRow>
                  </Box>
                  <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.75 }}>
                    {"You set it when you start."}
                  </Typography>
                </Box>
              )}
              {ready && (
              <Box>
                <Typography sx={label}>Budget</Typography>
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Select size="small" value={spend} onChange={(e) => setBudget(e.target.value)} sx={{ minWidth: 156, typography: "s2" }}>
                    {budgets.map((b) => <MenuItem key={b} value={b} sx={{ typography: "s2" }}>{creditsLabel(b)}</MenuItem>)}
                  </Select>
                  <Select size="small" value={spendMinutes} onChange={(e) => setMinutes(e.target.value)} sx={{ minWidth: 96, typography: "s2" }} inputProps={{ "aria-label": "Time budget" }}>
                    {minuteChoices.map((m) => <MenuItem key={m} value={m} sx={{ typography: "s2" }}>{`${m} min`}</MenuItem>)}
                  </Select>
                  <Typography sx={{ typography: "s2", color: "text.secondary" }}>
                    {`Likely ${creditsLabel(estimate.likely)} · between ${creditsForUsd(estimate.low).toLocaleString()} and ${creditsForUsd(estimate.high).toLocaleString()} · about ${estimate.minutes} min`}
                  </Typography>
                </Stack>
                <Typography sx={{ typography: "s3", color: overBudget || overTime ? "text.primary" : "text.subtitle", mt: 0.75 }}>
                  {overBudget || overTime
                    ? `Likely to stop at the ${overBudget ? "credit" : "time"} budget before the search finishes — you'll get the best it found by then. Raise it to search fully.`
                    : `About ${estimate.conversations.toLocaleString()} simulated conversations. If it runs over, it stops at the budget with the best it found so far.`}
                </Typography>
              </Box>
              )}
            </Stack>

            <Footer
              onClose={onClose}
              note={needsEnv
                ? "Build its environment first — then start the fix from here."
                : building ? "Its environment is still building — start the fix when it's done."
                  : "Nothing ships on its own — the fix ends as a draft for you to review."}
            >
              {needsEnv && (
                <Button variant="contained" color="primary" size="small" disabled={!!hardGate} onClick={() => setBuildOpen(true)} sx={{ typography: "s2", fontWeight: 700 }}>
                  Build environment
                </Button>
              )}
              {building && (
                <Button variant="contained" color="primary" size="small" disabled={!!hardGate} onClick={openBuilding} sx={{ typography: "s2", fontWeight: 700 }}>
                  Open environment
                </Button>
              )}
              {ready && (
                <Button
                  variant="contained" color="primary" size="small"
                  disabled={!chosen.length || !!hardGate || consentNeeded}
                  onClick={go}
                  startIcon={<Iconify icon="solar:magic-stick-3-linear" width={15} />}
                  sx={{ typography: "s2", fontWeight: 700 }}
                >
                  Start fix
                </Button>
              )}
            </Footer>
            {needsEnv && (
              <BuildEnvironmentDialog
                open={buildOpen}
                onClose={() => setBuildOpen(false)}
                agent={agent}
                defaultVersion={agent.production || agent.latest}
                onBuild={(choice) => {
                  setBuildOpen(false);
                  onClose();
                  navigate(paths.dashboard.simulate.environmentBuild, {
                    state: { presetSource: buildPresetFor(agent, choice), fromIssue: issue?.cluster_id || null },
                  });
                }}
              />
            )}
          </>
        )}
      </Stack>
    </SideDrawer>
  );
}

FixSheet.propTypes = { open: PropTypes.bool, onClose: PropTypes.func.isRequired, issue: PropTypes.object, rootCause: PropTypes.object };

function Footer({ onClose, note, closeLabel = "Cancel", children }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2.5, py: 1.75, borderTop: "1px solid", borderColor: "divider", flexShrink: 0 }}>
      <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1 }}>{note}</Typography>
      <Button onClick={onClose} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary" }}>{closeLabel}</Button>
      {children}
    </Stack>
  );
}
Footer.propTypes = { onClose: PropTypes.func, note: PropTypes.node, closeLabel: PropTypes.string, children: PropTypes.node };

/* One key–value row of the set-up summary — the constraints table's look. */
function SpecRow({ k, first = false, children }) {
  return (
    <Stack direction="row" spacing={2} sx={{ px: 1.5, py: 1, borderTop: first ? "none" : "1px solid", borderColor: "divider" }}>
      <Typography sx={{ typography: "s2", color: "text.subtitle", width: 150, flexShrink: 0 }}>{k}</Typography>
      <Box flex={1} minWidth={0}>{children}</Box>
    </Stack>
  );
}
SpecRow.propTypes = { k: PropTypes.string, first: PropTypes.bool, children: PropTypes.node };

