import PropTypes from "prop-types";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { paths } from "src/routes/paths";
import SideDrawer from "../../components/SideDrawer";
import { omegaReport, omegaVerdict, diagnosisTrace } from "../../_mock/omega";
import { proposalsFor, projectedRate, addressedCount, optimisable } from "../../_mock/optimize";
import { improvementRunName } from "../../_mock/optimizer";
import { shippedCandidate } from "./tradeoffs";
import { nextAgentVersion, currentEnvVersion } from "../../_mock/versions";
import { optimizationSummary, OPT_STATUS } from "../../_mock/optimizationRuns";
import { protoRunId } from "../../_mock/executionAdapter";
import DiagnosisPane from "./DiagnosisPane";
import ImprovementSetup from "./ImprovementSetup";
import { buildImprovement } from "../../_mock/improvementStart";
import { envAgentKey } from "../../_mock/agentRegistry";
import OptimizationRunView from "./OptimizationRunView";
import { useSimStore } from "../../store";

/**
 * Debug failures → Improve.
 *
 * One drawer, two widths. Narrow while you are reading what went wrong, wide
 * once an improvement run is open — because a diagnosis is a column of text
 * and an improvement run is a graph, a grid of trials and a scenario matrix.
 *
 * The drawer itself is the shared `SideDrawer`, so the page behind stays
 * readable and it looks like every other drawer in the product.
 */

export default function FixMyAgentDrawer({
  open, onClose, env, envState, patch, addAgentVersion, tasks, stats, runId, onOpenTask, onViewIssue, openOptimizationId,
}) {
  const navigate = useNavigate();
  const { state: simState } = useSimStore();
  /* Opening a row in the runs list lands on that run, not on the diagnosis —
     the list already told you which one you wanted. */
  const [view, setView] = useState(openOptimizationId ? "optimization" : "diagnosis");
  const [activeId, setActiveId] = useState(openOptimizationId || null);

  useEffect(() => {
    if (!open) return;
    setView(openOptimizationId ? "optimization" : "diagnosis");
    setActiveId(openOptimizationId || null);
  }, [open, openOptimizationId]);
  /*
    Every proposed change starts included — the improvement run acts on the
    whole diagnosis, not a hand-picked subset.
  */
  const [applied, setApplied] = useState({});

  const measured = useMemo(() => tasks.filter((t) => t.status !== "unmeasured"), [tasks]);
  const failing = useMemo(() => optimisable(tasks), [tasks]);

  const report = useMemo(
    () => omegaReport({ env, summary: { tasks }, baseline: null }),
    [env, tasks],
  );
  const proposals = useMemo(() => proposalsFor(env, failing, measured), [env, failing, measured]);

  /*
    Seed `applied` with every proposal id, once per proposal — a `seenRef`
    keeps a later identity change from resetting the map.
  */
  const seenRef = useRef(new Set());
  useEffect(() => {
    setApplied((prev) => {
      let changed = false;
      const next = { ...prev };
      proposals.forEach((p) => {
        if (seenRef.current.has(p.id)) return;
        seenRef.current.add(p.id);
        next[p.id] = true;
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [proposals]);
  const trace = useMemo(
    () => diagnosisTrace({ report, tasks, proposals, checks: [] }),
    [report, tasks, proposals],
  );

  const included = proposals.filter((p) => applied[p.id]);
  const projected = projectedRate(measured, included);
  const willFix = addressedCount(included);
  const current = Math.round((stats?.passRate || 0) * 100);

  const records = envState?.optimizations || [];
  const active = records.find((o) => o.id === activeId) || null;

  /* If the drawer opened from a trial page, `runId` is a synthetic trial id
     that doesn't exist in envState.runs — resolve it to the run the
     improvement run started from, so `fromRunId` always names a real run. */
  const trialM = /^(OPT-\d+)-t(\d+)$/.exec(runId || "");
  const sourceRunId = trialM ? (records.find((o) => o.id === trialM[1])?.fromRunId || runId) : runId;
  const sourceRun = (envState?.runs || []).find((r) => r.id === sourceRunId);
  /* The agent version the diagnosed run tested — what changes are made on. */
  const runAgentVersion = sourceRun?.agentVersion || null;
  const allScenarioIds = (envState?.scenarios || []).map((sc) => sc.id);
  const runScenarioIds = sourceRun?.scenarioIds?.length ? sourceRun.scenarioIds : allScenarioIds;

  /* Earlier improvement runs, newest first — so a finished one can be opened
     again from the diagnosis instead of only from the moment it ran. */
  const previous = useMemo(
    () => [...(envState?.optimizations || [])].reverse().map((o) => {
      const s = optimizationSummary(o);
      return { id: o.id, name: improvementRunName(envState, o), sub: o.status === OPT_STATUS.RUNNING ? "running" : s.sub ? `${s.headline} ${s.sub}` : "" };
    }),
    [envState],
  );

  /*
    Starting a run writes the record first and marks it running.

    The search is deterministic and returns instantly, but the record has to
    exist in a running state before the trace plays — otherwise closing the
    drawer mid-search would lose a run that, in a real system, is already
    burning episodes on somebody's infrastructure.
  */
  /*
    "Run improvement" opens Improve my agent, already on this agent and
    this environment: name it, pick the optimizer and model, the goal and the
    budget. Starting writes the record running and opens it here — closing
    the drawer mid-search doesn't lose a run that, in a real system, is
    already spending.
  */
  const [setupOpen, setSetupOpen] = useState(false);
  const startFromSetup = ({ name, model, envIds, goal, budget, limits, seed, lineage, reread, textSearch, targetMember, optimizerId }) => {
    const record = buildImprovement({
      reread, textSearch, targetMember, optimizerId, state: simState,
      env, es: envState, tasks, seed,
      fromRunId: sourceRunId,
      baseAgentVersion: runAgentVersion,
      trigger: { kind: "run", goal: goal ? { id: goal.id, label: goal.label, ...(goal.group && { group: goal.group }) } : undefined },
      limits, budget, regressionEnvIds: envIds, lineage,
      extra: {
        ...(name && { name }),
        ...(model && { model }),
        includedIds: included.map((p) => p.id),
        /* The diagnosis this attempt was made against, kept with it — six
           weeks on, "why did we try that" is only answerable if the evidence
           travelled with the attempt. */
        diagnosis: report.map((a) => ({ id: a.id, label: a.label, headline: a.headline, severity: a.severity })),
      },
    });
    patch({ optimizations: [...records, record] });
    setSetupOpen(false);
    setActiveId(record.id);
    setView("optimization");
  };

  const finish = () => {
    patch({
      optimizations: records.map((o) => (
        o.id === activeId
          ? { ...o, status: OPT_STATUS.COMPLETED, completedAt: new Date().toISOString() }
          : o
      )),
    });
  };

  /*
    A change landed — merged, pushed, or confirmed deployed. This is the only
    place a version is saved from here; a PR merge arrives with the version
    PrCard already saved. The projection the user saw is recorded beside it,
    with the env version and scenario set a run must match to answer it.
  */
  const land = ({ key, version: minted, origin, note, changes, projected: expected, projectedOn, scenarioIds }) => {
    const version = minted || {
      ...nextAgentVersion(envState, { note, applied: changes, fromRunId: sourceRunId, basedOnVersion: runAgentVersion }),
      origin,
    };
    if (!minted) addAgentVersion?.(version);
    const at = new Date().toISOString();
    patch({
      omegaExpectation: {
        key,
        version: version.label,
        fromRun: sourceRunId || null,
        projected: expected,
        projectedOn,
        envVersion: currentEnvVersion(env, envState)?.label || null,
        scenarios: scenarioIds,
        addresses: [...new Set(changes.flatMap((c) => c.addresses || []))],
        at,
      },
      /* Which hand-off landed as which version — so its button can't save a
         second one, whatever the expectation slot holds later. */
      handoffLandings: { ...(envState?.handoffLandings || {}), [key]: version.label },
    });
  };

  /* Re-run tests whatever version is current — after a landing, the new one.
     It never mints. */
  const rerun = (scenarioIds) => {
    const url = paths.dashboard.simulate.simulationRun(env.id, protoRunId(env.id, Date.now().toString(36)));
    const subset = scenarioIds?.length && scenarioIds.length < allScenarioIds.length;
    onClose();
    navigate(subset ? `${url}?only=${scenarioIds.join(",")}` : url);
  };

  /* The winner on every scenario at the current env version — trials only
     saw the training split. Tagged on the record so the runs list can name it. */
  const runWinner = (record, candidate = null) => {
    const id = protoRunId(env.id, Date.now().toString(36));
    patch({
      optimizations: records.map((o) => (
        o.id === record.id ? { ...o, verifyRunIds: [...(o.verifyRunIds || []), id] } : o
      )),
    });
    onClose();
    /* Run from a code snapshot when one was picked — the run says so. */
    const url = paths.dashboard.simulate.simulationRun(env.id, id);
    navigate(candidate ? `${url}?candidate=${encodeURIComponent(candidate)}` : url);
  };

  const provenance = { fromRunId: sourceRunId || null, basedOnVersion: runAgentVersion };
  const diagKey = `diag:${sourceRunId}`;
  const landedFor = (key) => envState?.handoffLandings?.[key] || null;

  const close = () => {
    setView("diagnosis");
    setActiveId(null);
    onClose();
  };

  return (
    <SideDrawer
      open={open}
      onClose={close}
      /*
        Wide enough for the widest thing it holds, and no wider — the
        scenario grid, at roughly 950px, sets the real requirement.
      */
      width={view === "optimization" ? { xs: "100%", md: 1060 } : { xs: "100%", sm: 570 }}
    >
      {view === "diagnosis" && (
        <DiagnosisPane
          tasks={tasks}
          report={report}
          trace={trace}
          proposals={proposals}
          verdict={omegaVerdict(report, failing)}
          applied={applied}
          setApplied={setApplied}
          current={current}
          projected={projected}
          willFix={willFix}
          measured={measured}
          failing={failing}
          onOpenTask={onOpenTask}
          onViewIssue={onViewIssue}
          runId={runId}
          onOptimize={() => setSetupOpen(true)}
          previous={previous}
          onOpenPrevious={(id) => { setActiveId(id); setView("optimization"); }}
          handoff={{
            key: diagKey,
            landedVersion: landedFor(diagKey),
            provenance,
            onLand: (info, changes, expected) => land({
              ...info, key: diagKey, changes, projected: expected,
              projectedOn: "if every addressed scenario passes", scenarioIds: runScenarioIds,
            }),
            onRerun: () => rerun(runScenarioIds),
          }}
          env={env}
          envState={envState}
          patch={patch}
          onClose={close}
        />
      )}

      {view === "optimization" && active && (
        <OptimizationRunView
          record={active}
          name={improvementRunName(envState, active)}
          env={env}
          envState={envState}
          patch={patch}
          tasks={tasks}
          onOpenTask={onOpenTask}
          onRunWinner={(candidate) => runWinner(active, candidate)}
          handoff={{
            key: active.id,
            landedVersion: landedFor(active.id),
            provenance,
            /* The held-out score is the number the screen showed, so it is
               the projection — and the full suite is what answers it. */
            onLand: (info) => land({
              ...info, key: active.id, changes: shippedCandidate(active)?.proposals || active.result?.winner?.proposals || [],
              projected: shippedCandidate(active)?.held ?? active.result?.heldScore, projectedOn: "held-back scenarios", scenarioIds: allScenarioIds,
            }),
            onRerun: () => rerun(allScenarioIds),
          }}
          onBack={() => { setView("diagnosis"); setActiveId(null); }}
          onClose={close}
          onDone={finish}
        />
      )}
      <ImprovementSetup
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        preset={{ agentKey: envAgentKey(envState?.agent, env?.id), envId: env?.id }}
        tasks={tasks}
        included={included}
        onStart={startFromSetup}
      />
    </SideDrawer>
  );
}

FixMyAgentDrawer.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func,
  env: PropTypes.object,
  envState: PropTypes.object,
  patch: PropTypes.func,
  addAgentVersion: PropTypes.func,
  tasks: PropTypes.array,
  stats: PropTypes.object,
  runId: PropTypes.string,
  onOpenTask: PropTypes.func,
  onViewIssue: PropTypes.func,
  openOptimizationId: PropTypes.string,
};
