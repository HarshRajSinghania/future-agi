import PropTypes from "prop-types";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Box, Button, Checkbox, Stack, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { neutralCheckboxSx } from "../components/primitives";
import { textTone } from "../components/textTone";
import { clickable, focusRing } from "../components/clickable";
import Iconify from "src/components/iconify";
import { paths } from "src/routes/paths";
import { useConnectedAgents } from "../store";
import { useIntegrations } from "../_mock/integrations";
import { evalSeries, runSummaries, trialSummaries } from "../_mock/comparison";
import { allMetrics, deltaAgainst } from "../_mock/winner";
import { Head, MetricCell, ScoreCell } from "../run/RunsTableCells";
import { compactTokens } from "../run/runsTableFormat";
import { candidatesOf } from "../run/fixmyagent/tradeoffs";
import RunsOverview from "../run/RunsOverview";
import WinnerDrawer from "../run/WinnerDrawer";
import { improvementRowsOf } from "./improvementRows";
import { chartRunOf, trialRowsFor } from "./improvementRunsData";
import StatusPill from "./ImprovementStatusPill";

const RED = "#DC2626";
const DELTA = 56;

/**
 * Improvements, level 2 — one improvement and the runs its search tried.
 * The pass rate across them, then the runs: pick two or more to compare them
 * scenario by scenario, or choose the winner by what matters here. A run
 * opens its own page (level 3).
 *
 * Choosing a winner only picks among runs that passed the checks; one the
 * search didn't verify reads as projected on the held-back set until it's
 * run on the full suite.
 */
export default function ImprovementRunsView({ env, envState, record, patch, onBack, backLabel, onOpenSearch, onVerify }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { agents, state: simState } = useConnectedAgents();
  const { prs } = useIntegrations();
  const [selected, setSelected] = useState([]);
  const [picking, setPicking] = useState(false);

  const row = useMemo(
    () => improvementRowsOf({ state: simState, agents, prs }).find((r) => r.envId === env.id && r.recordId === record.id) || null,
    [simState, agents, prs, env.id, record.id],
  );
  const candidates = useMemo(() => candidatesOf(record), [record]);
  const runs = useMemo(() => trialRowsFor(env, envState, record, candidates), [env, envState, record, candidates]);
  const chartRuns = useMemo(() => runs.map((r) => chartRunOf(r, record)), [runs, record]);
  const searchWinner = record.result?.winner?.n || null;
  const keptN = record.preferredTrial || searchWinner;
  const kept = runs.find((r) => r.n === keptN) || null;
  /* A winner you chose wasn't the one the search verified — it runs on the
     full suite, held-back scenarios included, before it can be reviewed. */
  const needsVerify = !!kept && keptN !== searchWinner && record.verifiedTrial !== keptN;

  /* Each run's numbers, and the run the improvement started from — what
     every change in the table is read against. */
  const summaries = useMemo(() => trialSummaries(env, envState).filter((t) => t.selfImprovementId === record.id), [env, envState, record.id]);
  const envRuns = useMemo(() => runSummaries(env, envState), [env, envState]);
  const startRun = envRuns.find((r) => r.id === record.fromRunId) || null;
  const evals = useMemo(() => evalSeries(envRuns, envState).map((e) => ({ id: e.id, name: e.name })), [envRuns, envState]);
  const metrics = useMemo(() => Object.fromEntries(allMetrics(evals).map((m) => [m.id, m])), [evals]);
  const tableRows = useMemo(() => runs.map((r) => ({ ...r, s: summaries.find((t) => t.trialN === r.n) || null })), [runs, summaries]);
  /* What the table's changes are read against — the run it started from,
     unless one of its own runs was set as the baseline (the same choice the
     environment's Runs tab offers). Kept on the improvement. */
  const baselineRow = record.baselineRunId ? tableRows.find((r) => r.runId === record.baselineRunId && r.s) || null : null;
  const baseline = baselineRow?.s || startRun;
  const setBaseline = (runId) => patch({
    optimizations: (envState?.optimizations || []).map((o) => (o.id === record.id
      ? { ...o, baselineRunId: runId && runId !== o.baselineRunId ? runId : undefined }
      : o)),
  });
  /* The chart leads with the winner, read against the run the improvement
     started from — the same change its row shows — not the latest run. */
  const headline = useMemo(() => {
    if (!kept) return null;
    const run = chartRuns.find((c) => c.id === kept.runId);
    if (!run) return null;
    const m = tableRows.find((r) => r.n === kept.n)?.s;
    return {
      run,
      /* Scored on the training scenarios, not the full suite its run page shows. */
      metric: "pass rate on training scenarios",
      label: `${kept.name} · winner`,
      delta: m && startRun ? deltaAgainst(metrics.passRate, m, startRun) : null,
      /* Not "Run N" — this page's own runs are numbered too. */
      against: "the run it started from",
    };
  }, [kept, chartRuns, tableRows, startRun, metrics]);
  /* Run · Status · Pass · Duration · Tokens · Cost · Said, not done · Return,
     then a column per grader — the Runs table's columns. */
  const template = `40px minmax(220px, 380px) 150px ${[...Array(6).fill(124), ...evals.map(() => 128)].map((c) => `minmax(${c}px, 1fr)`).join(" ")}`;
  const minWidth = 20 + 40 + 220 + 150 + 6 * 124 + evals.length * 128 + 8;

  /* Only runs that passed the checks are in the race. */
  const field = useMemo(() => {
    const eligible = new Set(candidates.filter((c) => c.eligible).map((c) => c.n));
    return trialSummaries(env, envState)
      .filter((t) => t.selfImprovementId === record.id && eligible.has(t.trialN))
      .map((t) => ({ ...t, partial: false }));
  }, [env, envState, record.id, candidates]);

  const choose = ({ runId }) => {
    const n = Number(/-t(\d+)$/.exec(runId)?.[1]) || null;
    patch({
      optimizations: (envState?.optimizations || []).map((o) => (o.id === record.id
        ? { ...o, preferredTrial: n && n !== searchWinner ? n : undefined }
        : o)),
    });
    setPicking(false);
  };

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  /* Compare comes back here, to this improvement's runs. */
  const compare = () => navigate(`${paths.dashboard.simulate.simulationCompare(env.id)}?runs=${selected.join(",")}`, {
    state: { back: { to: `${location.pathname}${location.search}`, label: row?.name || "the improvement", state: location.state } },
  });
  const openRun = (r) => navigate(paths.dashboard.simulate.simulationRun(env.id, r.runId));

  const statusOf = (r) => {
    if (r.n === keptN) {
      return (
        <Tooltip arrow title={r.n === searchWinner ? "The search kept this run — verified on the held-back scenarios." : needsVerify ? "Chosen by you — not yet run on the held-back scenarios. Verify it before review." : "Chosen by you and run on the full suite."}>
          <Typography noWrap sx={{ typography: "s2", fontWeight: 700 }}>
            Winner
            <Box component="span" sx={{ fontWeight: 400, color: "text.subtitle" }}>{r.n === searchWinner ? " · verified" : needsVerify ? " · not verified" : " · your pick"}</Box>
          </Typography>
        </Tooltip>
      );
    }
    if (r.why) {
      return (
        <Tooltip arrow title={`Not eligible — ${r.why}`}>
          <Typography noWrap sx={{ typography: "s2", color: RED }}>Rejected</Typography>
        </Tooltip>
      );
    }
    return <Typography noWrap sx={{ typography: "s2", color: "text.subtitle" }}>Not kept</Typography>;
  };

  return (
    <Box sx={{ height: "100%", overflow: "auto", p: 2, display: "flex", flexDirection: "column" }}>
      <Box sx={{ mb: 2, flexShrink: 0 }}>
        <Button
          size="small" onClick={onBack}
          startIcon={<Iconify icon="solar:arrow-left-linear" width={14} />}
          sx={{ typography: "s2", fontWeight: 600, color: "text.secondary", ml: -0.75, mb: 0.75, minWidth: 0 }}
        >
          {`Back to ${backLabel}`}
        </Button>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box flex={1} minWidth={0}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography noWrap sx={{ typography: "m3", fontWeight: 700 }}>{row?.name || record.name}</Typography>
              <StatusPill ending={row?.status} headline={row?.headline} />
            </Stack>
            {/* Where it ran and what started it; the version pair and id on hover. */}
            <Tooltip arrow placement="bottom-start" title={[row?.identity, record.id].filter(Boolean).join(" · ")}>
              <Typography noWrap sx={{ typography: "s2", color: "text.subtitle", mt: 0.25, width: "fit-content", maxWidth: "100%" }}>
                {[env.name, record.trigger?.issueId || row?.trigger?.label].filter(Boolean).join(" · ")}
              </Typography>
            </Tooltip>
          </Box>
          <Button
            size="small" variant="outlined" onClick={onOpenSearch}
            startIcon={<Iconify icon="solar:shield-check-linear" width={15} />}
            sx={{ typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider", flexShrink: 0 }}
          >
            How it was decided
          </Button>
          {kept && (needsVerify ? (
            <Tooltip arrow title="Runs it on the full suite, held-back scenarios included — the check the search's own pick already passed.">
              <Button
                size="small" variant="contained" color="primary" onClick={onVerify}
                startIcon={<Iconify icon="solar:play-bold" width={14} />}
                sx={{ typography: "s2", fontWeight: 700, flexShrink: 0 }}
              >
                {`Verify ${kept.name}`}
              </Button>
            </Tooltip>
          ) : (
            <Button
              size="small" variant="contained" color="primary" onClick={() => openRun(kept)}
              endIcon={<Iconify icon="solar:arrow-right-linear" width={14} />}
              sx={{ typography: "s2", fontWeight: 700, flexShrink: 0 }}
            >
              {`Review ${kept.name}`}
            </Button>
          ))}
        </Stack>
      </Box>

      <Box sx={{ mb: 2, flexShrink: 0 }}>
        <RunsOverview runs={chartRuns} evals={[]} headline={headline} onOpenRun={(r) => navigate(paths.dashboard.simulate.simulationRun(env.id, r.id))} />
      </Box>

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.25, flexShrink: 0 }}>
        <Typography sx={{ typography: "s1", fontWeight: 700 }}>{`Runs (${runs.length})`}</Typography>
        <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1 }}>
          {selected.length ? `${selected.length} selected` : baselineRow ? (
            <>
              Measured against{" "}
              <Box component="span" sx={{ color: "text.primary", fontWeight: 700 }}>{baselineRow.name || `Run ${baselineRow.n}`}</Box>
              {" "}— rates in points, everything else in percent
            </>
          ) : `Select two or more to compare them scenario by scenario${startRun ? ` · changes are against the run it started from, ${env.name} Run ${startRun.ordinal}` : ""}`}
        </Typography>
        {selected.length > 0 && (
          <Button size="small" onClick={() => setSelected([])} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary", minWidth: 0 }}>Clear</Button>
        )}
        {/* One run is a baseline; two or more is a comparison — as on the
            environment's Runs tab. */}
        {selected.length === 1 && patch ? (
          <Button
            size="small" variant="contained" color="primary"
            onClick={() => { setBaseline(selected[0]); setSelected([]); }}
            startIcon={<Iconify icon="solar:transfer-vertical-linear" width={15} />}
            sx={{ typography: "s2", fontWeight: 700 }}
          >
            {selected[0] === record.baselineRunId ? "Clear baseline" : "Set as baseline"}
          </Button>
        ) : selected.length === 0 && baselineRow && patch ? (
          <Button
            size="small" onClick={() => setBaseline(null)}
            startIcon={<Iconify icon="mingcute:close-line" width={14} />}
            sx={{ typography: "s2", fontWeight: 700, color: "primary.main" }}
          >
            Remove baseline
          </Button>
        ) : null}
        <Button
          size="small" variant="outlined" disabled={selected.length < 2} onClick={compare}
          startIcon={<Iconify icon="solar:transfer-horizontal-linear" width={15} />}
          sx={{ typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider" }}
        >
          Compare
        </Button>
        <Tooltip arrow title={field.length < 2 ? "Fewer than two runs passed the checks — there's nothing to choose between." : ""} disableHoverListener={field.length >= 2}>
          <Box component="span">
            <Button
              size="small" variant="outlined" disabled={field.length < 2} onClick={() => setPicking(true)}
              startIcon={<Iconify icon="solar:cup-star-bold" width={15} />}
              sx={{ typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider" }}
            >
              Choose winner
            </Button>
          </Box>
        </Tooltip>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 240, border: "1px solid", borderColor: "divider", borderRadius: 1.5, overflow: "auto", bgcolor: "background.paper" }}>
        <Box sx={{ minWidth }}>
          <Box sx={{ display: "grid", gridTemplateColumns: template, alignItems: "flex-end", pl: 2.5, pt: 1.5, pb: 1, borderBottom: "1px solid", borderColor: "divider" }}>
            <Box />
            <Head>Run</Head>
            <Head>Status</Head>
            <Head right title="Scenarios this run passed, on the training scenarios it was scored on">Pass</Head>
            <Head right title="Average duration per task">Duration</Head>
            <Head right>Tokens</Head>
            <Head right>Cost</Head>
            <Head right title="Tasks where the agent said it was done but the world shows it wasn't">Said, not done</Head>
            <Head right title="Mean return — the environment's reward, averaged over tasks">Return</Head>
            {evals.map((e, i) => (
              <Head key={e.id} right divider={i === 0} last={i === evals.length - 1} title={e.name} wrap>
                {e.name.replace(/_/g, "_\u200b")}
              </Head>
            ))}
          </Box>
          <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
            {tableRows.map((r) => {
              const picked = selected.includes(r.runId);
              const m = r.s;
              return (
                <Box
                  key={r.runId}
                  {...clickable(() => openRun(r), { role: "link" })}
                  sx={{
                    display: "grid", gridTemplateColumns: template, alignItems: "stretch", pl: 2.5, cursor: "pointer",
                    /* The baseline is marked by a rule and a chip, not a filled row. */
                    borderLeft: "2px solid", borderColor: r.runId === baselineRow?.runId ? "primary.main" : "transparent",
                    bgcolor: picked ? (t) => alpha(t.palette.primary.main, 0.05) : "transparent",
                    "&:hover": { bgcolor: "action.hover" },
                    ...focusRing,
                  }}
                >
                  {/* Selecting a run for Compare never opens it. The whole cell
                      toggles by mouse; Space on the checkbox toggles by keyboard. */}
                  <Box
                    sx={{ display: "flex", alignItems: "center" }}
                    onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) toggle(r.runId); }}
                  >
                    <Checkbox
                      size="small" checked={picked} onChange={() => toggle(r.runId)}
                      inputProps={{ "aria-label": `Select ${r.name || `Run ${r.n}`}` }}
                      sx={{ p: 0.5, pointerEvents: "none", ...neutralCheckboxSx }}
                    />
                  </Box>
                  <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0, py: 0.875, pr: 1.5 }}>
                    {/* The run's chip — the same R-badge and colour it wears on Compare. */}
                    <Box
                      sx={{
                        minWidth: 30, height: 22, px: 0.75, borderRadius: 0.75, flexShrink: 0,
                        display: "grid", placeItems: "center",
                        typography: "s3", fontWeight: 700, fontVariantNumeric: "tabular-nums",
                        color: r.s?.color ? textTone(r.s.color) : "text.secondary",
                        bgcolor: r.s?.color ? (t) => alpha(r.s.color, t.palette.mode === "dark" ? 0.22 : 0.14) : "background.neutral",
                      }}
                    >
                      {r.s?.letter || `R${r.n}`}
                    </Box>
                    <Box minWidth={0}>
                      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
                        <Typography noWrap sx={{ typography: "s2", fontWeight: 600 }}>{r.name}</Typography>
                        {r.runId === baselineRow?.runId && (
                          <Typography
                            sx={{
                              px: 0.75, py: 0.125, borderRadius: 0.5, flexShrink: 0,
                              typography: "s3", fontWeight: 700, color: "primary.main",
                              bgcolor: (t) => alpha(t.palette.primary.main, t.palette.mode === "dark" ? 0.2 : 0.12),
                            }}
                          >
                            Baseline
                          </Typography>
                        )}
                      </Stack>
                      {r.tried && <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>{r.tried}</Typography>}
                    </Box>
                  </Stack>
                  <Box sx={{ display: "flex", alignItems: "center", minWidth: 0, pr: 1 }}>{statusOf(r)}</Box>
                  <MetricCell anchor deltaWidth={DELTA} text={`${m?.passRate ?? r.score}%`} delta={m && deltaAgainst(metrics.passRate, m, baseline)} />
                  <MetricCell quiet deltaWidth={DELTA} text={m ? `${(m.avgDurationMs / 1000).toFixed(1)}s` : "—"} delta={m && deltaAgainst(metrics.duration, m, baseline)} />
                  <MetricCell quiet deltaWidth={DELTA} text={m ? compactTokens(m.tokens) : "—"} delta={m && deltaAgainst(metrics.tokens, m, baseline)} />
                  <MetricCell quiet deltaWidth={DELTA} text={m ? `$${m.cost.toFixed(2)}` : "—"} delta={m && deltaAgainst(metrics.cost, m, baseline)} />
                  <MetricCell quiet={!m?.saidNotDone} deltaWidth={DELTA} text={m ? `${m.saidNotDone}` : "—"} delta={m && deltaAgainst(metrics.saidNotDone, m, baseline)} />
                  <MetricCell anchor deltaWidth={DELTA} text={m?.meanReturn == null ? "—" : m.meanReturn.toFixed(2)} delta={m && deltaAgainst(metrics.meanReturn, m, baseline)} />
                  {evals.map((e, i) => (
                    <ScoreCell
                      key={e.id}
                      value={m?.scores?.[e.id] ?? null}
                      deltaWidth={DELTA}
                      delta={m && metrics[`eval:${e.id}`] ? deltaAgainst(metrics[`eval:${e.id}`], m, baseline) : null}
                      divider={i === 0}
                      last={i === evals.length - 1}
                    />
                  ))}
                </Box>
              );
            })}
          </Stack>
        </Box>
      </Box>

      <WinnerDrawer
        open={picking}
        onClose={() => setPicking(false)}
        summaries={field}
        evals={evals}
        scenarioCount={envState?.scenarios?.length || 0}
        env={env}
        envState={envState}
        nameOf={(r) => `Run ${r.trialN}`}
        showSummary={false}
        onApply={choose}
      />
    </Box>
  );
}

ImprovementRunsView.propTypes = {
  env: PropTypes.object.isRequired,
  envState: PropTypes.object,
  record: PropTypes.object.isRequired,
  patch: PropTypes.func.isRequired,
  onBack: PropTypes.func.isRequired,
  backLabel: PropTypes.string,
  onOpenSearch: PropTypes.func,
  /* Runs the chosen winner on the full suite. */
  onVerify: PropTypes.func,
};
