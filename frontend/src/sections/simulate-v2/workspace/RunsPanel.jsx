import PropTypes from "prop-types";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { alpha } from "@mui/material/styles";
import { Box, Stack, Typography, Button, Grid, TextField, MenuItem, LinearProgress, Tooltip } from "@mui/material";
import Iconify from "src/components/iconify";
import { paths } from "src/routes/paths";
import { protoRunId } from "../_mock/executionAdapter";
import { resolveEval } from "../_mock/evals";
import { getAgentType } from "../_mock/agentTypes";
import { getSurface } from "../_mock/surfaces";
import { agentVersionsWithRuns, currentAgentVersion } from "../_mock/versions";
import { runIdentityOf } from "../_mock/runIdentity";
import { runResultOf } from "../_mock/runResult";
import { runReadiness } from "../_mock/setupGaps";
import { SectionCard, EmptyState, StatusChip } from "../components/primitives";
import RunsSummary from "../run/RunsSummary";
import useRunFitCheck from "../run/useRunFitCheck";
import useRunGroup from "../run/useRunGroup";
import AlsoRunIn from "../run/AlsoRunIn";
import { useEnvState } from "../store";
import { runEnvVersion } from "../_mock/toolFit";
import { snapshotLabelOf } from "../_mock/envSnapshot";
import { envLabelOf } from "../_mock/envVersionKinds";
import useEnvViewAs from "./useEnvViewAs";
import { durationLabel as durationOf, parallelOf, runSizeOf } from "../_mock/runStream";
import { runDefaultsOf } from "../_mock/rsiModel";
import { clickable, focusRing } from "../components/clickable";

/**
 * Pre-flight + run history.
 *
 * Before a run costs anyone real money, this shows exactly what is about to
 * happen: how many tasks, against which agent, graded by what. After the first
 * run it becomes the history list.
 */
export default function RunsPanel({ env, envState, onGo }) {
  const navigate = useNavigate();
  const { patch } = useEnvState(env.id);
  const { check: checkRunFit, dialog: runFitDialog } = useRunFitCheck(env, envState, patch);
  const [scope, setScope] = useState("all");
  /* Optional: one environment version, one scenario-set version. */
  const [envScope, setEnvScope] = useState("all");
  /* Other environments testing this agent that the first run also starts in. */
  const [alsoRunIn, setAlsoRunIn] = useState([]);
  const runGroup = useRunGroup(env.id);
  const groupWith = alsoRunIn.filter((id) => runGroup.candidates.some((c) => c.envId === id && c.ready));
  const surface = getSurface(env.surface);
  const agentType = getAgentType(envState.agent?.typeId);
  /* Same readiness as every other Run button — evaluations included. */
  const readiness = runReadiness(envState);
  const ready = readiness.ready;
  /* Viewing an older environment version: only the runs taken on it. */
  const { viewAs } = useEnvViewAs(env, envState);
  const scoped = scope === "all"
    ? envState.runs
    : envState.runs.filter((r) => r.agentVersion === scope);

  /* What the first run would be: every live scenario × the repeats Settings
     sets (3 unless changed), at the conversations-at-once it sets. */
  const { repeats: defaultRepeats } = runDefaultsOf(envState);
  const size = runSizeOf({
    scenarios: envState.scenarios.filter((sc) => !sc.archived && !sc.retired).length,
    repeats: defaultRepeats,
    surface: env.surface,
    parallel: parallelOf(envState),
  });

  const startRun = () => checkRunFit(() => {
    if (groupWith.length) {
      runGroup.start(groupWith, { trials: defaultRepeats });
      return;
    }
    const runId = protoRunId(env.id, Date.now().toString(36));
    navigate(`${paths.dashboard.simulate.simulationRun(env.id, runId)}?trials=${defaultRepeats}`);
  });

  /*
    Once there is anything to compare, this step is the summary rather than a
    launcher; new runs start from the header's Run simulation button.

    Results are scoped by agent version (PRD v7 AC-14.1, 14.3): pin the view
    to one agent version — and optionally one environment or scenario-set
    version — and only that version's runs, traces and verdicts show.
  */
  if (envState.runs.length > 0) {
    const base = viewAs ? envState.runs.filter((r) => runEnvVersion(env, envState, r) === viewAs) : envState.runs;
    if (viewAs && !base.length) {
      return (
        <Box sx={{ p: 2 }}>
          <EmptyState
            icon="solar:play-circle-linear"
            title={`No runs on environment ${envLabelOf(env, envState, viewAs)}`}
            body="Every run here was taken on another version. Go back to current to see them."
          />
        </Box>
      );
    }
    const inScope = base.filter((r) => (scope === "all" || r.agentVersion === scope)
      && (viewAs || envScope === "all" || snapshotLabelOf(r, env, envState) === envScope));
    return (
      <>
        <RunsScopeBar
          env={env}
          envState={envState}
          runs={base}
          shown={inScope.length}
          agent={scope}
          onAgent={setScope}
          envVersion={viewAs ? null : envScope}
          onEnvVersion={viewAs ? null : setEnvScope}
        />
        {inScope.length ? (
          <RunsSummary key={`${scope}|${envScope}`} env={env} envState={{ ...envState, runs: inScope }} onGo={onGo} />
        ) : (
          <Box sx={{ p: 2 }}>
            <EmptyState
              icon="solar:play-circle-linear"
              title={`No runs of agent ${scope} on this selection`}
              body="This environment has runs, but none with that agent, environment and scenario-set version together. Widen the scope, or run the suite against it."
            />
          </Box>
        )}
      </>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      {runFitDialog}
      <Box sx={{ mb: 3 }}>
        <Typography sx={{ typography: "m2", fontWeight: 600 }}>Run simulation</Typography>
        <Typography sx={{ typography: "s1", color: "text.secondary" }}>
          Every scenario runs in its own clean copy of {env.name}.
        </Typography>
      </Box>

      {/* ── pre-flight ── */}
      <SectionCard
        title="Pre-flight"
        action={
          <Stack direction="row" alignItems="center" spacing={1}>
            <AlsoRunIn
              candidates={runGroup.candidates}
              value={alsoRunIn}
              onChange={setAlsoRunIn}
              agentVersion={currentAgentVersion(envState)?.label}
            />
            <Tooltip arrow title={readiness.reason}>
              <span>
                <Button
                  variant="contained"
                  color="primary"
                  disabled={!ready}
                  onClick={startRun}
                  startIcon={<Iconify icon="solar:play-bold" width={16} />}
                  sx={{ typography: "s2", fontWeight: 700 }}
                >
                  {groupWith.length ? `Start in ${groupWith.length + 1} environments` : "Start simulation"}
                </Button>
              </span>
            </Tooltip>
          </Stack>
        }
      >
        <Grid container spacing={0} sx={{ p: 2.5 }} rowSpacing={2}>
          <PreflightItem
            xs={6} md={3}
            label="Environment"
            value={env.name}
            sub={surface.label}
            icon={surface.icon}
            color={surface.color}
            ok
          />
          <PreflightItem
            xs={6} md={3}
            label="Agent"
            value={agentType?.label || "Not connected"}
            sub={envState.agent ? "Connection verified" : "Required"}
            icon={agentType?.icon || "solar:cpu-bolt-linear"}
            color={agentType?.color}
            ok={!!envState.agent}
            onFix={() => onGo("overview")}
          />
          <PreflightItem
            xs={6} md={3}
            label="Scenarios"
            value={`${envState.scenarios.length} scenarios`}
            sub={envState.scenarios.length ? `${envState.scenarios.filter((s) => s.critical).length} critical` : "Required"}
            icon="solar:layers-minimalistic-linear"
            color="#7857FC"
            ok={envState.scenarios.length > 0}
            onFix={() => onGo("scenarios")}
          />
          <PreflightItem
            xs={6} md={3}
            label="Evals"
            value={`${envState.evals.length} applied`}
            sub={envState.evals.length ? envState.evals.slice(0, 2).map((e) => resolveEval(e)?.name).join(", ") : "Optional — sub-goals decide pass or fail"}
            icon="solar:shield-check-linear"
            color="#16A34A"
            ok
            onFix={() => onGo("evals")}
          />
        </Grid>

        <Stack
          direction="row"
          spacing={2}
          sx={{ px: 2.5, py: 2, borderTop: "1px solid", borderColor: "divider", bgcolor: "background.neutral" }}
        >
          {/* Voice runs in real time, so its length is quoted from the calls
              themselves; chat runs to Phase 1's time targets. */}
          <Estimate
            icon="solar:clock-circle-linear" label="Est. duration"
            value={size.voice ? `≈ ${durationOf(size.voice.parallel)}` : `~${Math.max(2, Math.ceil(envState.scenarios.length * 0.7))} min`}
            hint={size.voice ? size.voice.line : null}
          />
          <Estimate icon="solar:bolt-circle-linear" label="Concurrency" value={`Up to ${size.parallel} at once`} />
          <Estimate
            icon="solar:layers-minimalistic-linear" label="Conversations"
            value={`${size.conversations} of ${size.cap}`}
            hint={size.over ? `${size.reason}.` : `At most ${size.cap} conversations a run, 1–20 repeats each.`}
          />
          <Estimate icon="solar:dollar-minimalistic-linear" label="Est. cost" value={`$${(envState.scenarios.length * 0.08).toFixed(2)}`} />
        </Stack>
      </SectionCard>

      {/* ── history ── */}
      <Box sx={{ mt: 3 }}>
        <SectionCard
          title={`Run history (${scoped.length})`}
          subtitle={scope === "all" ? undefined : `Showing only runs of agent ${scope}`}
          action={
            /*
              Scoping to a version is what makes a history readable: a mixed
              list of numbers from three different agents compares nothing.
            */
            <TextField
              select size="small" label="Agent version" value={scope}
              onChange={(e) => setScope(e.target.value)}
              sx={{ minWidth: 150, "& .MuiInputBase-input": { typography: "s2", py: 0.75 } }}
            >
              <MenuItem value="all" sx={{ typography: "s2" }}>All versions</MenuItem>
              {agentVersionsWithRuns(envState).map((v) => (
                <MenuItem key={v.id} value={v.label} sx={{ typography: "s2" }}>
                  {v.label}{v.current ? " · current" : ""}
                </MenuItem>
              ))}
            </TextField>
          }
        >
          {scoped.length === 0 ? (
            <EmptyState
              icon="solar:play-circle-linear"
              title={scope === "all" ? "No runs yet" : `No runs of agent ${scope}`}
              body={
                scope === "all"
                  ? "Start a simulation above and you'll be able to watch every task execute live."
                  : "This environment has runs, but none against that agent version. Switch the scope, or run the suite against it."
              }
            />
          ) : (
            <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
              {scoped.map((raw) => {
                /* Scored from the run's own scenarios — what the run screen shows. */
                const r = raw.status === "running" ? raw : runResultOf(env, envState, raw);
                /* A row can be mid-flight — the run is recorded as soon
                   as the simulation starts (so the user sees it in
                   history immediately even if they navigate away), then
                   updated with final stats when it completes. Rows with
                   status "running" show a pulsing "Running" chip and
                   skip the pass-rate arithmetic that would otherwise
                   render "NaN%" on an empty run. */
                const isRunning = r.status === "running";
                const timestamp = isRunning
                  ? `Started ${new Date(r.startedAt).toLocaleString()}`
                  : new Date(r.finishedAt || r.startedAt).toLocaleString();
                const passRate = r.rate ?? 0;
                return (
                  <Stack
                    key={r.id}
                    direction="row"
                    alignItems="center"
                    spacing={2}
                    {...clickable(() => navigate(paths.dashboard.simulate.simulationRun(env.id, r.id)), { role: "link" })}
                    sx={{ ...focusRing, px: 2.5, py: 1.75, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
                  >
                    <Box flex={1} minWidth={0}>
                      <Typography noWrap sx={{ typography: "s2", fontWeight: 600 }}>{r.label}</Typography>
                      <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
                        {timestamp} · {r.total} scenarios
                        {r.agentVersion ? ` · ${runIdentityOf(r, envState, env).label}` : ""}
                        {r.seed != null ? ` · seed ${r.seed}` : ""}
                      </Typography>
                    </Box>
                    {isRunning ? (
                      <Box sx={{ width: 120, display: { xs: "none", sm: "block" } }}>
                        <LinearProgress
                          sx={{
                            height: 4,
                            borderRadius: 2,
                            bgcolor: "action.hover",
                            "& .MuiLinearProgress-bar": { bgcolor: "primary.main" },
                          }}
                        />
                      </Box>
                    ) : (
                      <Box sx={{ width: 120, display: { xs: "none", sm: "block" } }}>
                        <PassBar passed={r.passed} total={r.measured ?? r.total} />
                      </Box>
                    )}
                    <Typography sx={{ typography: "s2", fontWeight: 700, width: 54, textAlign: "right", fontVariantNumeric: "tabular-nums", color: isRunning ? "text.subtitle" : "text.primary" }}>
                      {isRunning ? "—" : `${passRate}%`}
                    </Typography>
                    <StatusChip
                      status={
                        isRunning
                          ? "running"
                          : r.passed === (r.measured ?? r.total) && r.total > 0
                            ? "passed"
                            : "failed"
                      }
                    />
                  </Stack>
                );
              })}
            </Stack>
          )}
        </SectionCard>
      </Box>
    </Box>
  );
}

RunsPanel.propTypes = {
  env: PropTypes.object.isRequired,
  envState: PropTypes.object.isRequired,
  onGo: PropTypes.func,
};

function PreflightItem({ xs, md, label, value, sub, icon, color, ok, warn, onFix }) {
  const state = ok ? (warn ? "#CA8A04" : "#16A34A") : "#DC2626";
  return (
    <Grid item xs={xs} md={md}>
      <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ pr: 2 }}>
        <Box
          sx={{
            width: 32, height: 32, borderRadius: 1, display: "grid", placeItems: "center", flexShrink: 0,
            bgcolor: (t) => alpha(color || "#7857FC", t.palette.mode === "dark" ? 0.16 : 0.1),
            color: color || "#7857FC",
          }}
        >
          <Iconify icon={icon} width={16} />
        </Box>
        <Box minWidth={0}>
          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{label}</Typography>
          <Typography noWrap sx={{ typography: "s2", fontWeight: 700 }}>{value}</Typography>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Iconify
              icon={ok ? (warn ? "solar:info-circle-bold" : "solar:check-circle-bold") : "solar:close-circle-bold"}
              width={11}
              sx={{ color: state, flexShrink: 0 }}
            />
            <Typography noWrap sx={{ typography: "s3", color: warn && ok ? "text.secondary" : state }}>{sub}</Typography>
            {!ok && onFix && (
              <Button size="small" onClick={onFix} sx={{ minWidth: 0, px: 0.5, typography: "s3", fontWeight: 700 }}>
                Fix
              </Button>
            )}
          </Stack>
        </Box>
      </Stack>
    </Grid>
  );
}
PreflightItem.propTypes = {
  xs: PropTypes.number, md: PropTypes.number, label: PropTypes.string, value: PropTypes.node,
  sub: PropTypes.node, icon: PropTypes.string, color: PropTypes.string,
  ok: PropTypes.bool, warn: PropTypes.bool, onFix: PropTypes.func,
};

function Estimate({ icon, label, value, hint = null }) {
  const body = (
    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ cursor: hint ? "default" : undefined }}>
      <Iconify icon={icon} width={15} sx={{ color: "text.subtitle" }} />
      <Typography sx={{ typography: "s2", color: "text.subtitle" }}>{label}</Typography>
      <Typography sx={{ typography: "s2", fontWeight: 700 }}>{value}</Typography>
    </Stack>
  );
  return hint ? <Tooltip arrow title={hint}>{body}</Tooltip> : body;
}
Estimate.propTypes = { icon: PropTypes.string, label: PropTypes.string, value: PropTypes.node, hint: PropTypes.string };

export function PassBar({ passed, total }) {
  const pct = total ? (passed / total) * 100 : 0;
  return (
    <Box sx={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", bgcolor: "background.neutral" }}>
      <Box sx={{ width: `${pct}%`, bgcolor: "#16A34A" }} />
      <Box sx={{ width: `${100 - pct}%`, bgcolor: "#DC2626" }} />
    </Box>
  );
}
PassBar.propTypes = { passed: PropTypes.number, total: PropTypes.number };

/*
  The scope the Runs tab reads at (AC-14.1): an agent version, and
  optionally an environment version and a scenario-set version. Compact,
  one line — the selectors only appear when there is more than one value to
  pick between.
*/
function RunsScopeBar({ env, envState, runs, shown, agent, onAgent, envVersion, onEnvVersion }) {
  const agents = agentVersionsWithRuns(envState).filter((v) => v.runs > 0);
  /* Environment versions (snapshots), newest first. */
  const envs = [...new Set(runs.map((r) => snapshotLabelOf(r, env, envState)).filter(Boolean))]
    .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  const reference = envState.referenceAgentVersion || null;
  const selectSx = { minWidth: 132, "& .MuiInputBase-input": { typography: "s2", py: 0.5 } };
  /* Newest version first, like the runs table. */
  const chips = [{ label: "all", text: "All", count: runs.length }, ...[...agents].reverse().map((v) => ({
    label: v.label, text: v.label, count: v.runs, note: [v.current ? "current" : null, v.label === reference ? "reference" : null].filter(Boolean).join(" · "),
  }))];
  return (
    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" rowGap={1} sx={{ px: 2, pt: 2, pb: 0.5 }}>
      <Typography sx={{ typography: "s2", color: "text.subtitle", mr: 0.25 }}>Agent version</Typography>
      {/* One click per version — every number below reads that version's runs alone. */}
      {chips.map((c) => {
        const on = agent === c.label;
        return (
          <Tooltip key={c.label} arrow title={c.note || ""} disableHoverListener={!c.note}>
            <Box
              role="button" tabIndex={0} aria-pressed={on}
              onClick={() => onAgent(c.label)} onKeyDown={(e) => { if (e.key === "Enter") onAgent(c.label); }}
              sx={{
                display: "inline-flex", alignItems: "center", gap: 0.625, height: 28, px: 1.25, borderRadius: 0.75, cursor: "pointer",
                border: "1px solid", borderColor: on ? "text.primary" : "divider",
                bgcolor: (t) => (on ? alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.08 : 0.05) : "transparent"),
                "&:hover": { borderColor: on ? "text.primary" : "text.disabled" },
              }}
            >
              <Typography sx={{ typography: "s2", fontWeight: on ? 700 : 500 }}>{c.text}</Typography>
              {c.label === reference && <Typography sx={{ typography: "s3" }}>★</Typography>}
              <Typography sx={{ typography: "s3", color: "text.subtitle", fontVariantNumeric: "tabular-nums" }}>{c.count}</Typography>
            </Box>
          </Tooltip>
        );
      })}
      {onEnvVersion && envs.length > 1 && (
        <TextField select size="small" value={envVersion} onChange={(e) => onEnvVersion(e.target.value)} sx={{ ...selectSx, ml: "16px !important" }}>
          <MenuItem value="all" sx={{ typography: "s2" }}>All environment versions</MenuItem>
          {envs.map((v) => <MenuItem key={v} value={v} sx={{ typography: "s2" }}>{`Environment ${v}`}</MenuItem>)}
        </TextField>
      )}
      {(agent !== "all" || (envVersion && envVersion !== "all")) && (
        <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{`${shown} of ${runs.length} runs`}</Typography>
      )}
    </Stack>
  );
}

RunsScopeBar.propTypes = {
  env: PropTypes.object, envState: PropTypes.object, runs: PropTypes.array, shown: PropTypes.number,
  agent: PropTypes.string, onAgent: PropTypes.func, envVersion: PropTypes.string, onEnvVersion: PropTypes.func,
};
