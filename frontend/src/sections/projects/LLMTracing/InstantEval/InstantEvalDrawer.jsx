import React, { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Drawer,
  IconButton,
  LinearProgress,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import Iconify from "src/components/iconify";
import { collectPopulation } from "src/sections/projects/observePopulation";
import { insightsReportLink } from "src/sections/projects/observeHandoff";
import InstantEvalComposer from "./InstantEvalComposer";
import InstantEvalHistory from "./InstantEvalHistory";
import InstantEvalResults from "./results/InstantEvalResults";
import { useJevAvailability } from "./useJevAvailability";
import { useInstantEvalRun, useInstantEvals } from "./useInstantEval";
import {
  DEFAULT_LIMIT,
  LIMIT_OPTIONS,
  draftsFromQuestions,
  handedOverScope,
  scopeLabel,
  scopeLine,
  unitMeta,
} from "./instantEvalUnits";

const DRAWER_WIDTH = 640;
const APPLIED_SEEDS = new Set();
const POPULATION_FRESH_MS = 60_000;

/**
 * Instant eval, opened in place from a Traces, Spans, Sessions or Users view:
 * ask Jev a question about every row in the view and read the answers here,
 * as they land, while the grid stays usable beside it. History lists every
 * past run of this view and reopens its results.
 *
 * scope: { filters, label } — the exact backend filters the view's grid sends
 *   and its date label.
 * seed: a hand-off from Insights ({ unit, questions?, ids?, label? }); a new
 *   seedKey replaces whatever is on screen with it.
 */
export default function InstantEvalDrawer({
  open,
  onClose,
  projectId,
  unit,
  scope,
  seed,
  seedKey,
  onOpenRow,
  onShowInGrid,
  onRunFinished,
}) {
  const navigate = useNavigate();
  const meta = unitMeta(unit);
  const jev = useJevAvailability();
  const { run, start, rerun, reset } = useInstantEvalRun(projectId, unit);
  // A past run opened from History, shown apart from the run in Ask.
  const past = useInstantEvalRun(projectId, unit, { persist: false });
  const [pastOpen, setPastOpen] = useState(false);
  const [tab, setTab] = useState("ask");
  // The tab indicator is measured once the drawer has slid in.
  const tabsAction = useRef(null);
  // A hand-off is for the view it names, and applies once per page: the
  // drawer remounts when the Traces view switches between traces and spans.
  const unitSeed =
    seed && (seed.unit || "traces") === unit && !APPLIED_SEEDS.has(seedKey)
      ? seed
      : null;
  const [handedOver, setHandedOver] = useState(() =>
    handedOverScope(unitSeed, unit),
  );
  const [initialQuestions, setInitialQuestions] = useState(() =>
    unitSeed?.questions ? draftsFromQuestions(unitSeed.questions) : null,
  );
  const [composerKey, setComposerKey] = useState(0);

  // A new hand-off replaces whatever was on screen.
  useEffect(() => {
    if (!seedKey || !unitSeed) return;
    APPLIED_SEEDS.add(seedKey);
    reset();
    setTab("ask");
    setHandedOver(handedOverScope(unitSeed, unit));
    setInitialQuestions(
      unitSeed.questions ? draftsFromQuestions(unitSeed.questions) : null,
    );
    setComposerKey((key) => key + 1);
    // Once per hand-off key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const showComposer = run.phase === "idle" || run.phase === "failed";
  const filters = useMemo(() => scope?.filters || [], [scope?.filters]);
  const label = useMemo(
    () => scopeLabel({ label: scope?.label, filters }),
    [scope?.label, filters],
  );

  // How many rows are in view. Reading up to the largest run size proves the
  // count a run can take; beyond that the line says "500+".
  const maxLimit = Math.max(...LIMIT_OPTIONS[unit]);
  const population = useQuery({
    queryKey: [
      "instant-eval-population",
      projectId,
      unit,
      JSON.stringify(filters),
    ],
    enabled:
      open &&
      tab === "ask" &&
      Boolean(projectId) &&
      showComposer &&
      !handedOver,
    queryFn: async ({ signal }) => ({
      ...(await collectPopulation({
        unit,
        projectId,
        filters,
        limit: maxLimit,
        signal,
      })),
      limit: maxLimit,
    }),
    staleTime: 30_000,
    meta: { errorHandled: true },
  });

  // Saved questions also name the evaluators of past runs in History.
  const saved = useInstantEvals(projectId, { enabled: open, unit });
  const configsById = useMemo(
    () => Object.fromEntries(saved.all.map((item) => [item.configId, item])),
    [saved.all],
  );
  const queryClient = useQueryClient();

  // When a run finishes: its questions join the saved list and History, and
  // the view refreshes (trace answers become grid columns).
  const finished = useRef(null);
  useEffect(() => {
    if (run.phase !== "done" || !run.taskId || finished.current === run.taskId)
      return;
    finished.current = run.taskId;
    saved.refetch?.();
    queryClient.invalidateQueries({
      queryKey: ["instant-eval-history", projectId],
    });
    if (!run.viewing) onRunFinished?.(run);
    // Once per finished run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.phase, run.taskId]);

  const openPastRun = (runItem) => {
    past.view({
      taskId: runItem.taskId,
      items: runItem.items,
      scopeFilters: [],
      startedAt: runItem.createdAt,
      asked:
        runItem.unit !== "users" && runItem.rows
          ? { rows: runItem.rows }
          : null,
    });
    setPastOpen(true);
  };
  const closePastRun = () => {
    past.reset();
    setPastOpen(false);
  };

  // The rows just counted for the scope line are the rows a run asks about;
  // an older read is left for the run to redo.
  const runScope = () => ({
    filters,
    label,
    handedOver,
    ...(!handedOver &&
    population.data &&
    Date.now() - population.dataUpdatedAt < POPULATION_FRESH_MS
      ? { population: population.data }
      : {}),
  });

  const newQuestion = () => {
    reset();
    setTab("ask");
    setInitialQuestions(null);
    setComposerKey((key) => key + 1);
  };

  // A past run's questions asked again over what is in view now.
  const askAgain = (items) => {
    rerun({
      items,
      limit: DEFAULT_LIMIT[unit],
      scope: { filters, label, handedOver: null },
    });
    closePastRun();
    setTab("ask");
  };

  const scopeText = handedOver
    ? scopeLine({ unit, handedOver })
    : population.isLoading
      ? `Counting the ${meta.plural} in this view…`
      : population.data
        ? scopeLine({ unit, population: population.data, label })
        : label;

  const busy = ["collecting", "creating"].includes(run.phase);

  const results = (shownRun, { onRunAgain }) => (
    <InstantEvalResults
      projectId={projectId}
      unit={unit}
      run={shownRun}
      navigate={navigate}
      onOpenRow={onOpenRow}
      onShowInGrid={onShowInGrid}
      onInsights={(insightsSeed) =>
        navigate(insightsReportLink(projectId, insightsSeed))
      }
      onRunAgain={jev.available ? onRunAgain : undefined}
    />
  );

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="persistent"
      SlideProps={{
        onEntered: () => tabsAction.current?.updateIndicator(),
      }}
      PaperProps={{
        sx: {
          width: DRAWER_WIDTH,
          maxWidth: "100vw",
          height: "100vh",
          borderLeft: "1px solid",
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          bgcolor: "background.paper",
          // Under the trace and session drawers a row opens into.
          zIndex: (theme) => theme.zIndex.drawer - 1,
          boxShadow: (theme) => theme.shadows[8],
        },
      }}
    >
      <Box
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        sx={{ display: "flex", flexDirection: "column", height: "100%" }}
      >
        <Box
          sx={{
            px: 2.5,
            pt: 2,
            borderBottom: "1px solid",
            borderColor: "divider",
            flexShrink: 0,
          }}
        >
          <Stack
            direction="row"
            alignItems="flex-start"
            justifyContent="space-between"
            spacing={1}
          >
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Iconify
                  icon="mdi:creation-outline"
                  width={20}
                  sx={{ color: "primary.main" }}
                />
                <Typography variant="h6">Instant eval</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Ask Jev about every {meta.noun} in this view.
              </Typography>
            </Box>
            <Tooltip title="Close">
              <IconButton onClick={onClose} aria-label="Close Instant eval">
                <Iconify icon="mdi:close" width={20} />
              </IconButton>
            </Tooltip>
          </Stack>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mt: 1 }}
          >
            <Tabs
              action={tabsAction}
              value={tab}
              onChange={(_, next) => setTab(next)}
              aria-label="Instant eval"
              sx={{
                minHeight: 36,
                "& .MuiTab-root": {
                  minHeight: 36,
                  py: 0.5,
                  px: 0,
                  mr: 2.5,
                  minWidth: 0,
                  textTransform: "none",
                  fontWeight: 600,
                },
              }}
            >
              <Tab value="ask" label="Ask" />
              <Tab value="history" label="History" />
            </Tabs>
            {tab === "ask" && !showComposer && (
              <Button
                size="small"
                startIcon={<Iconify icon="mdi:plus" width={16} />}
                onClick={newQuestion}
                disabled={busy}
                sx={{ textTransform: "none" }}
              >
                New question
              </Button>
            )}
            {tab === "history" && pastOpen && (
              <Button
                size="small"
                startIcon={<Iconify icon="mdi:arrow-left" width={16} />}
                onClick={closePastRun}
                sx={{ textTransform: "none" }}
              >
                All runs
              </Button>
            )}
          </Stack>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 2.5, py: 2 }}>
          <Stack spacing={2}>
            {jev.isLoading && <LinearProgress />}
            {!jev.isLoading && !jev.available && (
              <Alert
                severity="info"
                action={
                  jev.settingsPath && (
                    <Button
                      size="small"
                      onClick={() => navigate(jev.settingsPath)}
                      sx={{ textTransform: "none" }}
                    >
                      Open AI Providers
                    </Button>
                  )
                }
              >
                {jev.reason}
              </Alert>
            )}
            {tab === "ask" && run.phase === "failed" && (
              <Alert severity="error" onClose={newQuestion}>
                {run.error}
              </Alert>
            )}
            {tab === "ask" &&
              (showComposer ? (
                <InstantEvalComposer
                  key={composerKey}
                  unit={unit}
                  initialQuestions={initialQuestions}
                  scopeText={scopeText}
                  population={population}
                  handedOver={handedOver}
                  onClearHandoff={() => setHandedOver(null)}
                  onRun={({ questions, reads, limit }) =>
                    start({ questions, reads, limit, scope: runScope() })
                  }
                  disabled={!jev.available || jev.isLoading}
                  savedQuestions={saved.items}
                />
              ) : (
                results(run, {
                  onRunAgain: () =>
                    rerun({
                      items: run.items,
                      limit: run.limit || DEFAULT_LIMIT[unit],
                      scope: run.handedOver
                        ? { ...runScope(), handedOver: run.handedOver }
                        : runScope(),
                    }),
                })
              ))}
            {tab === "history" &&
              (pastOpen ? (
                results(past.run, {
                  onRunAgain: () => askAgain(past.run.items),
                })
              ) : (
                <InstantEvalHistory
                  projectId={projectId}
                  unit={unit}
                  configsById={configsById}
                  enabled={open && tab === "history"}
                  onOpen={openPastRun}
                  onAsk={() => setTab("ask")}
                />
              ))}
          </Stack>
        </Box>
      </Box>
    </Drawer>
  );
}

InstantEvalDrawer.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  projectId: PropTypes.string.isRequired,
  unit: PropTypes.oneOf(["traces", "spans", "sessions", "users"]).isRequired,
  scope: PropTypes.shape({
    filters: PropTypes.array,
    label: PropTypes.string,
  }),
  seed: PropTypes.object,
  seedKey: PropTypes.string,
  onOpenRow: PropTypes.func,
  onShowInGrid: PropTypes.func,
  onRunFinished: PropTypes.func,
};
