import React, { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Drawer,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import Iconify from "src/components/iconify";
import { collectPopulation } from "src/sections/projects/observePopulation";
import { analyseReportLink } from "src/sections/projects/observeHandoff";
import InstantEvalComposer from "./InstantEvalComposer";
import InstantEvalResults from "./results/InstantEvalResults";
import { useJevAvailability } from "./useJevAvailability";
import {
  useInstantEvalHistory,
  useInstantEvalRun,
  useInstantEvals,
} from "./useInstantEval";
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

/**
 * Instant eval, opened in place from a Traces, Sessions or Users view: ask Jev
 * a question about every row in the view and read the answers here while the
 * grid stays usable beside it.
 *
 * scope: { filters, label } — the exact backend filters the view's grid sends
 *   and its date label.
 * seed: a hand-off from Analyse ({ unit, questions?, ids?, label? }); a new
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
  const { run, start, rerun, view, reset } = useInstantEvalRun(projectId, unit);
  const [handedOver, setHandedOver] = useState(() =>
    handedOverScope(seed, unit),
  );
  const [initialQuestions, setInitialQuestions] = useState(() =>
    seed?.questions ? draftsFromQuestions(seed.questions) : null,
  );
  const [composerKey, setComposerKey] = useState(0);

  // A new hand-off replaces whatever was on screen.
  const appliedSeed = useRef(null);
  useEffect(() => {
    if (!seedKey || appliedSeed.current === seedKey) return;
    appliedSeed.current = seedKey;
    reset();
    setHandedOver(handedOverScope(seed, unit));
    setInitialQuestions(
      seed?.questions ? draftsFromQuestions(seed.questions) : null,
    );
    setComposerKey((key) => key + 1);
  }, [seedKey, seed, unit, reset]);

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
    enabled: open && Boolean(projectId) && showComposer && !handedOver,
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

  const saved = useInstantEvals(projectId, {
    enabled: open && jev.available,
    unit,
  });
  const configsByName = useMemo(
    () => Object.fromEntries(saved.all.map((item) => [item.name, item])),
    [saved.all],
  );
  const history = useInstantEvalHistory(projectId, configsByName, {
    enabled: open && jev.available && showComposer,
    unit,
  });

  // When a run finishes: its questions join the saved list and the history,
  // and the view refreshes (trace answers become grid columns).
  const finished = useRef(null);
  useEffect(() => {
    if (run.phase !== "done" || !run.taskId || finished.current === run.taskId)
      return;
    finished.current = run.taskId;
    saved.refetch?.();
    history.refetch?.();
    if (!run.viewing) onRunFinished?.(run);
    // Once per finished run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.phase, run.taskId]);

  const runScope = () => ({ filters, label, handedOver });

  const newQuestion = () => {
    reset();
    setInitialQuestions(null);
    setComposerKey((key) => key + 1);
  };

  const scopeText = handedOver
    ? scopeLine({ unit, handedOver })
    : population.isLoading
      ? `Counting the ${meta.plural} in this view…`
      : population.data
        ? scopeLine({ unit, population: population.data, label })
        : label;

  const busy = ["collecting", "creating"].includes(run.phase);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="persistent"
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
        <Stack
          direction="row"
          alignItems="flex-start"
          justifyContent="space-between"
          spacing={1}
          sx={{
            px: 2.5,
            py: 2,
            borderBottom: "1px solid",
            borderColor: "divider",
            flexShrink: 0,
          }}
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
          <Stack direction="row" alignItems="center" spacing={0.5}>
            {!showComposer && (
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
            <Tooltip title="Close">
              <IconButton onClick={onClose} aria-label="Close Instant eval">
                <Iconify icon="mdi:close" width={20} />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

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
            {run.phase === "failed" && (
              <Alert severity="error" onClose={newQuestion}>
                {run.error}
              </Alert>
            )}
            {showComposer ? (
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
                pastRuns={history.runs}
                onViewRun={(runItem) =>
                  view({
                    taskId: runItem.taskId,
                    items: runItem.items,
                    scopeFilters: runItem.scopeFilters,
                    startedAt: runItem.createdAt,
                  })
                }
              />
            ) : (
              <InstantEvalResults
                projectId={projectId}
                unit={unit}
                run={run}
                navigate={navigate}
                onOpenRow={onOpenRow}
                onShowInGrid={onShowInGrid}
                onAnalyse={(analyseSeed) =>
                  navigate(analyseReportLink(projectId, analyseSeed))
                }
                onRunAgain={
                  jev.available
                    ? () =>
                        rerun({
                          items: run.items,
                          limit: run.limit || DEFAULT_LIMIT[unit],
                          scope: run.handedOver
                            ? { ...runScope(), handedOver: run.handedOver }
                            : runScope(),
                        })
                    : undefined
                }
              />
            )}
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
  unit: PropTypes.oneOf(["traces", "sessions", "users"]).isRequired,
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
