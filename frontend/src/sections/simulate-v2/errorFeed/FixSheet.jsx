import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Checkbox, IconButton, InputBase, MenuItem, Select, Stack, Switch, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { paths } from "src/routes/paths";
import SideDrawer from "../components/SideDrawer";
import { agentSourceOf, agentDefinitionOf } from "../_mock/agentRegistry";
import { currentAgentVersion } from "../_mock/versions";
import { currentEnvSnapshot } from "../_mock/envSnapshot";
import { DEFAULT_LIMITS, limitRows } from "../_mock/optimizationRuns";
import { useAgentImprovementFlag } from "../_mock/featureFlags";
import PreviewBadge from "./PreviewBadge";
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
export default function FixSheet({ open, onClose, issue, rootCause = null }) {
  const navigate = useNavigate();
  const improving = useAgentImprovementFlag();
  const { state, agent, agents, project, gate, start, tracing, evidence, status } = useIssueFix(issue);
  /* A fix runs in the agent's main environment — never one picked per fix. */
  const envs = useMemo(() => envsForAgent(agent, state), [agent, state]);
  const main = envs[0] || null;
  const inFlight = !!agent && !!status && FIX_IN_FLIGHT.has(status.key);
  const [connecting, setConnecting] = useState(false);
  const mainState = main ? state.byEnv[main.id] : null;
  const [target, setTarget] = useState("");
  const [textSearch, setTextSearch] = useState(null);
  const [buildOpen, setBuildOpen] = useState(false);

  const drafts = useMemo(() => (main ? issueScenarioDrafts(issue, main, mainState) : []), [issue, main, mainState]);
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
  }, [open, drafts, main]);
  useEffect(() => {
    if (!open) return;
    setTarget("");
    setTextSearch(null);
  }, [open]);
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
  /* Phase 1 runs in the main environment only — no extra regression runs. */
  const estimate = fixEstimate({ preview, scenarioCount: chosen.length, regressionCount: 0, surface: main?.surface });
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
  const model = useMemo(() => {
    if (!agent || !main) return null;
    const def = agentDefinitionOf({ agent, env: main, envState: mainState });
    return def.model?.visible ? def.model.name : null;
  }, [agent, main, mainState]);
  const constraints = limitRows(limits, model);

  const go = () => {
    const at = start({
      env: main, drafts: chosen, regressionEnvIds: [main.id], budget: spend, minutes: spendMinutes,
      textSearch: inText, targetMember: target || undefined, rootCause,
    });
    onClose();
    navigate(...issueFixNav(at, issue?.cluster_id));
  };

  const meta = [issue?.cluster_id, issue?.trace_count && `${issue.trace_count} traces`, issue?.severity].filter(Boolean).join(" · ");
  /* "agent v2 × environment v7" — what a regression environment would run. */
  const pairOf = (e) => {
    const es = state.byEnv[e.id];
    const envLabel = currentEnvSnapshot(e, es)?.label;
    return `agent ${currentAgentVersion(es)?.label || "—"} × environment ${envLabel || "—"}`;
  };

  if (!improving) return null;

  return (
    <SideDrawer open={open} onClose={onClose} width={600}>
      <Stack sx={{ height: "100%" }}>
        <Stack direction="row" alignItems="flex-start" spacing={2} sx={{ px: 2.5, py: 2, borderBottom: "1px solid", borderColor: "divider", flexShrink: 0 }}>
          <Box flex={1} minWidth={0}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography sx={{ typography: "m2", fontWeight: 600 }}>Fix this issue</Typography>
              <PreviewBadge />
            </Stack>
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

        {/* ── an agent with nowhere to test it ──
            A fix runs in the agent's main environment (RSI PRD: "Fix uses it
            by default"), and the first one built becomes main. Build it from
            here; the builder brings you back to this issue. */}
        {agent && !inFlight && !main && (
          <>
            <Box sx={{ flex: 1, p: 2.5 }}>
              <Typography sx={{ typography: "s2", fontWeight: 600 }}>{`${agent.name} isn't tested in an environment yet`}</Typography>
              <Typography sx={{ typography: "s2", color: "text.secondary", mt: 0.5 }}>
                A fix is proven in simulation before anything ships, so it runs in the agent&apos;s main environment — the first one you build becomes it. Build one now; when it&apos;s ready, come back and Fix opens here with this issue&apos;s scenarios.
              </Typography>
            </Box>
            <Footer onClose={onClose}>
              <Button size="small" onClick={() => navigate(`${paths.dashboard.agents}/connected/${agent.id}`)} sx={{ typography: "s2", fontWeight: 700, color: "text.secondary" }}>
                Open the agent
              </Button>
              <Button variant="contained" color="primary" size="small" onClick={() => setBuildOpen(true)} sx={{ typography: "s2", fontWeight: 700 }}>
                Build environment
              </Button>
            </Footer>
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
          </>
        )}

        {/* ── the fix ── */}
        {agent && !inFlight && main && (
          <>
            <Stack spacing={2.5} sx={{ flex: 1, overflow: "auto", p: 2.5 }}>
              {/* Fix starts on confirmed issues only — the rest wait, and say why. */}
              {evidence && (
                <Stack direction="row" spacing={1.25} sx={{ px: 1.5, py: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                  <Iconify icon="solar:info-circle-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0, mt: "1px" }} />
                  <Box flex={1} minWidth={0}>
                    <Typography sx={{ typography: "s2", fontWeight: 600 }}>{`Fix starts on confirmed issues · ${evidence.title}`}</Typography>
                    <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>{evidence.body}</Typography>
                  </Box>
                </Stack>
              )}
              {/* Fix proves the change against production — it needs the traces. */}
              {!tracing && !gate && (
                <Stack direction="row" spacing={1.25} sx={{ px: 1.5, py: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                  <Iconify icon="solar:lock-keyhole-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0, mt: "1px" }} />
                  <Box flex={1} minWidth={0}>
                    <Typography sx={{ typography: "s2", fontWeight: 600 }}>{`Fix needs ${agent.name}'s production traces`}</Typography>
                    <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>Turn on Watch production calls on the agent&apos;s Connections tab — simulations still run without it.</Typography>
                  </Box>
                  <Button
                    size="small" variant="outlined"
                    onClick={() => { onClose(); navigate(`${paths.dashboard.agents}/connected/${agent.id}?tab=connections`); }}
                    sx={{ typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider", flexShrink: 0, alignSelf: "center" }}
                  >
                    Open Connections
                  </Button>
                </Stack>
              )}
              {gate && (
                <Stack direction="row" spacing={1.25} sx={{ px: 1.5, py: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                  <Iconify icon="solar:lock-keyhole-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0, mt: "1px" }} />
                  <Box flex={1} minWidth={0}>
                    <Typography sx={{ typography: "s2", fontWeight: 600 }}>{gate.title}</Typography>
                    <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>{gate.body}</Typography>
                  </Box>
                  {gate.action === "connections" && (
                    <Button
                      size="small" variant="outlined"
                      onClick={() => { onClose(); navigate(`${paths.dashboard.agents}/connected/${agent.id}?tab=connections`); }}
                      sx={{ typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider", flexShrink: 0, alignSelf: "center" }}
                    >
                      Open Connections
                    </Button>
                  )}
                </Stack>
              )}
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
                        ? "From the Root cause tab — the search starts from it."
                        : "The feed's first read. The fix diagnoses it before searching — or run Find root cause first for a fuller one."}
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
                <Stack direction="row" alignItems="center" spacing={1.25} sx={rowSx(false)}>
                  <Box flex={1} minWidth={0}>
                    <Typography noWrap sx={{ typography: "s2", fontWeight: 600 }}>{main.name}</Typography>
                    <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>Main environment · where every fix for this agent runs</Typography>
                  </Box>
                </Stack>
                {/* Its must-pass set is the regression check (three scenario sets). */}
                <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.75 }}>
                  {`${pairOf(main)} · its must-pass scenarios are the regression check — any it breaks rejects the candidate.`}
                </Typography>
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
                        size="small" checked={!!picked[d.id]}
                        onChange={(e) => setPicked((p) => ({ ...p, [d.id]: e.target.checked }))}
                        sx={{ p: 0.25, mt: 0.125 }}
                      />
                      <Box flex={1} minWidth={0}>
                        {/* The title is the scenario — edit it in place. */}
                        <InputBase
                          fullWidth multiline value={titles[d.id] ?? d.title}
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
                    {`Critical sub-goal on each — the step that failed in production: “${drafts[0].subGoals[1]}”.`}
                  </Typography>
                )}
                <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.75 }}>
                  {`Starting the fix adds the ones you keep to ${main.name} as a new version of its scenarios, so they stay covered after the fix ships. Each is reproduced first; only the ones that fail become targets, and some are held back to prove the fix on scenarios it never saw.`}
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
                  A candidate that breaks any of these is rejected, however much it helps.
                </Typography>
              </Box>

              {main.surface === "voice" && (
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
            </Stack>

            <Footer onClose={onClose} note="Nothing ships on its own — the fix ends as a draft for you to review.">
              <Button
                variant="contained" color="primary" size="small"
                disabled={!chosen.length || !!gate || !!evidence || !tracing}
                onClick={go}
                startIcon={<Iconify icon="solar:magic-stick-3-linear" width={15} />}
                sx={{ typography: "s2", fontWeight: 700 }}
              >
                Start fix
              </Button>
            </Footer>
          </>
        )}
      </Stack>
    </SideDrawer>
  );
}

FixSheet.propTypes = { open: PropTypes.bool, onClose: PropTypes.func.isRequired, issue: PropTypes.object, rootCause: PropTypes.object };

function Footer({ onClose, note, children }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2.5, py: 1.75, borderTop: "1px solid", borderColor: "divider", flexShrink: 0 }}>
      <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1 }}>{note}</Typography>
      <Button onClick={onClose} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary" }}>Cancel</Button>
      {children}
    </Stack>
  );
}
Footer.propTypes = { onClose: PropTypes.func, note: PropTypes.node, children: PropTypes.node };
