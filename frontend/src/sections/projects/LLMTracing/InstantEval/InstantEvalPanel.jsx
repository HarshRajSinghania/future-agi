import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import Iconify from "src/components/iconify";
import { CAPABILITY, useFeatureAllowed } from "src/hooks/useCapabilities";
import QuestionEditor from "./QuestionEditor";
import {
  ANSWER_TYPES,
  MAX_QUESTIONS,
  READS,
  TRACE_LIMIT_OPTIONS,
  validateInstantEval,
} from "./instantEvalPayloads";
import {
  createContinuousTask,
  explainErrorGroups,
  useInstantEvalHistory,
  useInstantEvals,
} from "./useInstantEval";
import { getSafeActionErrorMessage } from "src/utils/errorUtils";

const PANEL_WIDTH = 500;
const LATE_ARRIVAL_OVERLAP_MS = 5 * 60 * 1000;

const EXAMPLES = [
  {
    question:
      "Did the agent promise a refund without checking the order first?",
    answerType: ANSWER_TYPES.YES_NO,
    categories: [],
  },
  {
    question: "Is the customer frustrated or upset?",
    answerType: ANSWER_TYPES.YES_NO,
    categories: [],
  },
  {
    question: "What is the customer contacting support about?",
    answerType: ANSWER_TYPES.CATEGORY,
    categories: ["Refund", "Shipping", "Product question", "Account", "Other"],
  },
];

const emptyQuestion = () => ({
  question: "",
  answerType: ANSWER_TYPES.YES_NO,
  categories: [],
});

function AnswerBars({ item, counts, onToggle, isActive }) {
  const total = item.labels.reduce((sum, label) => sum + (counts?.[label] || 0), 0);
  return (
    <Stack spacing={1}>
      {item.labels.map((label) => {
        const count = counts?.[label] || 0;
        const share = total ? Math.round((count / total) * 100) : 0;
        const active = isActive(item.configId, label);
        return (
          <Box key={label}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ mb: 0.5 }}
            >
              <Typography variant="body2" fontWeight={600}>
                {label}
              </Typography>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  {count} · {share}%
                </Typography>
                <Button
                  size="small"
                  variant={active ? "contained" : "outlined"}
                  disabled={!count && !active}
                  onClick={() => onToggle(item, label)}
                  startIcon={
                    <Iconify
                      icon={active ? "mdi:filter-check" : "mdi:filter-outline"}
                      width={14}
                    />
                  }
                  sx={{ textTransform: "none", py: 0, minWidth: 0 }}
                >
                  {active ? "Filtering" : "Filter grid"}
                </Button>
              </Stack>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={share}
              sx={{ height: 6, borderRadius: 1 }}
              aria-label={`${label}: ${count} of ${total}`}
            />
          </Box>
        );
      })}
    </Stack>
  );
}

AnswerBars.propTypes = {
  item: PropTypes.object.isRequired,
  counts: PropTypes.object,
  onToggle: PropTypes.func.isRequired,
  isActive: PropTypes.func.isRequired,
};

function SavedEvals({ items, onToggle, isActive, onRerun, isLoading }) {
  if (isLoading) return <LinearProgress sx={{ my: 1 }} />;
  if (!items?.length) return null;
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">
        Saved questions in this project
      </Typography>
      <Stack spacing={1} sx={{ mt: 0.5 }}>
        {items.map((item) => (
          <Box
            key={item.configId}
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              p: 1.25,
            }}
          >
            <Typography variant="body2" sx={{ mb: 0.75 }}>
              {item.question}
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {item.labels.map((label) => {
                const active = isActive(item.configId, label);
                return (
                  <Chip
                    key={label}
                    size="small"
                    color={active ? "primary" : "default"}
                    variant={active ? "filled" : "outlined"}
                    icon={<Iconify icon="mdi:filter-outline" width={14} />}
                    label={label}
                    onClick={() => onToggle(item, label)}
                  />
                );
              })}
              <Chip
                size="small"
                icon={<Iconify icon="mdi:refresh" width={14} />}
                label="Run on this view"
                onClick={() => onRerun(item)}
              />
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

SavedEvals.propTypes = {
  items: PropTypes.array,
  onToggle: PropTypes.func.isRequired,
  isActive: PropTypes.func.isRequired,
  onRerun: PropTypes.func.isRequired,
  isLoading: PropTypes.bool,
};

const STATUS_CHIP = {
  completed: { label: "Completed", color: "success" },
  running: { label: "Running", color: "info" },
  pending: { label: "Starting", color: "info" },
  failed: { label: "Failed", color: "error" },
  paused: { label: "Paused", color: "warning" },
};

const formatWhen = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

const formatRange = (range) =>
  range?.length === 2
    ? `${new Date(range[0]).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })} – ${new Date(range[1]).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}`
    : "No date window";

function HistoryList({ runs, isLoading, activeTaskId, onView, onRerunNew, onRerunView }) {
  if (isLoading) return <LinearProgress sx={{ my: 2 }} />;
  if (!runs.length)
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <Iconify icon="mdi:history" width={28} sx={{ color: "text.disabled" }} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Runs you start here are kept, so you can reopen their answers or
          rerun the same questions on new traces.
        </Typography>
      </Box>
    );
  return (
    <Stack spacing={1.25}>
      {runs.map((runItem) => {
        const chip = STATUS_CHIP[runItem.status] || {
          label: runItem.status,
          color: "default",
        };
        const isActive = runItem.taskId === activeTaskId;
        return (
          <Box
            key={runItem.taskId}
            sx={{
              border: "1px solid",
              borderColor: isActive ? "primary.main" : "divider",
              borderRadius: 1,
              p: 1.5,
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ mb: 0.75 }}
            >
              <Chip size="small" label={chip.label} color={chip.color} variant="outlined" />
              <Typography variant="caption" color="text.secondary" noWrap>
                {formatWhen(runItem.createdAt)} · {formatRange(runItem.dateRange)}
                {runItem.filterCount
                  ? ` · ${runItem.filterCount} filter${runItem.filterCount > 1 ? "s" : ""}`
                  : ""}
              </Typography>
            </Stack>
            <Stack spacing={0.25} sx={{ mb: 1 }}>
              {runItem.items.map((item, index) => (
                <Typography key={item.configId} variant="body2">
                  {runItem.items.length > 1 ? `${index + 1}. ` : ""}
                  {item.question}
                </Typography>
              ))}
            </Stack>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <Button
                size="small"
                variant={isActive ? "contained" : "outlined"}
                startIcon={<Iconify icon="mdi:eye-outline" width={14} />}
                onClick={() => onView(runItem)}
                sx={{ textTransform: "none" }}
              >
                {isActive ? "Showing" : "View"}
              </Button>
              <Button
                size="small"
                startIcon={<Iconify icon="mdi:update" width={14} />}
                onClick={() => onRerunNew(runItem)}
                sx={{ textTransform: "none" }}
              >
                Rerun on new data
              </Button>
              <Button
                size="small"
                startIcon={<Iconify icon="mdi:refresh" width={14} />}
                onClick={() => onRerunView(runItem)}
                sx={{ textTransform: "none" }}
              >
                Rerun on this view
              </Button>
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}

HistoryList.propTypes = {
  runs: PropTypes.array.isRequired,
  isLoading: PropTypes.bool,
  activeTaskId: PropTypes.string,
  onView: PropTypes.func.isRequired,
  onRerunNew: PropTypes.func.isRequired,
  onRerunView: PropTypes.func.isRequired,
};

export default function InstantEvalPanel({
  open,
  onClose,
  runApi,
  projectId,
  dateLabel,
  filterCount,
  getScopeFilters,
  onToggleAnswerFilter,
  isAnswerFilterActive,
  onClearAnswerFilters,
  hasAnswerFilters,
  onOpenEvaluator,
  onOpenTask,
}) {
  const jev = useFeatureAllowed(CAPABILITY.JEV_MODELS);
  const [questions, setQuestions] = useState([emptyQuestion()]);
  const [reads, setReads] = useState("input_output");
  const [limit, setLimit] = useState(100);
  const [touched, setTouched] = useState(false);
  const [live, setLive] = useState({ state: "idle" });
  const [tab, setTab] = useState("ask");
  const { run, start, rerun, view, reset } = runApi;
  const saved = useInstantEvals(projectId, { enabled: open && jev.allowed });
  const configsByName = Object.fromEntries(
    (saved.all || []).map((item) => [item.name, item]),
  );
  const history = useInstantEvalHistory(projectId, configsByName, {
    enabled: open && jev.allowed && tab === "history",
  });

  const currentScope = () => ({ scopeFilters: getScopeFilters() });
  const errors = questions.map((q) => validateInstantEval(q));
  const hasErrors = errors.some(Boolean);
  const isBusy = run.phase === "creating" || run.phase === "running";
  const isEditing = run.phase === "idle" || run.phase === "failed";

  useEffect(() => {
    if (run.phase !== "done") setLive({ state: "idle" });
    if (run.phase === "done") {
      saved.refetch?.();
      history.refetch?.();
    }
    // Refresh the saved list once per finished run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.phase]);

  const updateQuestion = (index, value) =>
    setQuestions((prev) => prev.map((q, i) => (i === index ? value : q)));

  const applyExample = (example) => {
    setQuestions((prev) => {
      const blank = prev.findIndex((q) => !q.question.trim());
      if (blank >= 0)
        return prev.map((q, i) => (i === blank ? { ...example } : q));
      if (prev.length >= MAX_QUESTIONS) return prev;
      return [...prev, { ...example }];
    });
    setTouched(false);
  };

  const handleRun = () => {
    setTouched(true);
    if (hasErrors) return;
    start({ questions, reads, limit, scope: currentScope() });
  };

  const handleKeepAnswering = async () => {
    setLive({ state: "creating" });
    try {
      const taskId = await createContinuousTask({
        projectId,
        items: run.items,
        scopeFilters: run.scopeFilters || [],
      });
      setLive({ state: "done", taskId });
    } catch (error) {
      setLive({
        state: "error",
        error: getSafeActionErrorMessage(
          error,
          "The live task could not be created.",
        ),
      });
    }
  };

  const handleRerun = (item) =>
    rerun({ items: [item], limit, scope: currentScope() });

  const handleView = (runItem) => {
    view({
      taskId: runItem.taskId,
      items: runItem.items,
      scopeFilters: runItem.scopeFilters,
      startedAt: runItem.createdAt,
    });
    setTab("ask");
  };

  // Traces that arrived after that run: same filters, and a window that
  // starts where that run's window ended. It overlaps by a few minutes so
  // traces ingested late (timestamped before the run, stored after it) are
  // still answered; re-answering a boundary trace costs a fraction of a cent.
  const handleRerunNew = (runItem) => {
    const previousEnd = Math.min(
      new Date(runItem.dateRange?.[1] || runItem.createdAt).getTime(),
      new Date(runItem.createdAt).getTime(),
    );
    const window = [
      new Date(previousEnd - LATE_ARRIVAL_OVERLAP_MS).toISOString(),
      new Date().toISOString(),
    ];
    const scopeFilters = [
      ...runItem.scopeFilters.filter((f) => f.column_id !== "created_at"),
      {
        column_id: "created_at",
        filter_config: {
          filter_type: "datetime",
          filter_op: "between",
          filter_value: window,
        },
      },
    ];
    rerun({
      items: runItem.items,
      limit: 500,
      scope: { scopeFilters, since: runItem.createdAt },
    });
    setTab("ask");
  };

  const handleRerunView = (runItem) => {
    rerun({ items: runItem.items, limit, scope: currentScope() });
    setTab("ask");
  };

  const processed = (run.completed || 0) + (run.failed || 0);
  const progressValue = run.total
    ? Math.min(100, (processed / run.total) * 100)
    : 0;

  return (
    // Persistent (non-modal) so the grid stays visible and clickable while
    // answers are applied to it as filters.
    <Drawer
      anchor="right"
      variant="persistent"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: PANEL_WIDTH,
          maxWidth: "100vw",
          height: "100vh",
          position: "fixed",
          borderRadius: "0px !important",
          display: "flex",
          flexDirection: "column",
          boxShadow: (theme) => theme.customShadows?.dropdown || theme.shadows[8],
          zIndex: (theme) => theme.zIndex.drawer + 1,
        },
      }}
    >
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        sx={{ px: 2.5, pt: 2, pb: 1.5 }}
      >
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Iconify icon="mdi:creation-outline" width={20} />
            <Typography variant="h6">Instant eval</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Ask questions in plain English. Jev answers each one for every
            trace in this view, and every answer becomes a filter you can
            combine with the rest of the grid.
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Close instant eval">
          <Iconify icon="akar-icons:cross" width={16} />
        </IconButton>
      </Stack>
      <Tabs
        value={tab}
        onChange={(_, value) => setTab(value)}
        sx={{ px: 2.5, minHeight: 36, "& .MuiTab-root": { minHeight: 36 } }}
      >
        <Tab value="ask" label="Ask" />
        <Tab value="history" label="History" />
      </Tabs>
      <Divider />

      <Box sx={{ flex: 1, overflowY: "auto", px: 2.5, py: 2 }}>
        {jev.isLoading ? (
          <LinearProgress />
        ) : jev.allowed && tab === "history" ? (
          <HistoryList
            runs={history.runs}
            isLoading={history.isLoading}
            activeTaskId={run.taskId}
            onView={handleView}
            onRerunNew={handleRerunNew}
            onRerunView={handleRerunView}
          />
        ) : !jev.allowed ? (
          <Alert severity="info">
            Instant evals run on Jev, which isn&apos;t enabled for this
            workspace. Ask your Future AGI admin or contact sales to turn on
            Jev evaluators.
          </Alert>
        ) : isEditing ? (
          <Stack spacing={2}>
            {run.phase === "failed" && (
              <Alert severity="error" onClose={reset}>
                {run.error}
              </Alert>
            )}
            {hasAnswerFilters && (
              <Alert
                severity="info"
                action={
                  <Button size="small" onClick={onClearAnswerFilters}>
                    Clear
                  </Button>
                }
              >
                The grid is filtered by instant eval answers.
              </Alert>
            )}

            {questions.map((value, index) => (
              <QuestionEditor
                key={index}
                index={index}
                value={value}
                autoFocus={index === questions.length - 1}
                error={touched ? errors[index] : null}
                onChange={(next) => updateQuestion(index, next)}
                onRemove={
                  questions.length > 1
                    ? () =>
                        setQuestions((prev) =>
                          prev.filter((_, i) => i !== index),
                        )
                    : undefined
                }
              />
            ))}

            <Stack direction="row" alignItems="center" spacing={1}>
              <Button
                size="small"
                startIcon={<Iconify icon="mdi:plus" width={16} />}
                disabled={questions.length >= MAX_QUESTIONS}
                onClick={() =>
                  setQuestions((prev) => [...prev, emptyQuestion()])
                }
                sx={{ textTransform: "none" }}
              >
                Add another question
              </Button>
              <Typography variant="caption" color="text.secondary">
                Up to {MAX_QUESTIONS} in one pass
              </Typography>
            </Stack>

            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mb: 0.75 }}
              >
                Try one
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {EXAMPLES.map((example) => (
                  <Chip
                    key={example.question}
                    size="small"
                    variant="outlined"
                    label={example.question}
                    onClick={() => applyExample(example)}
                    sx={{ maxWidth: "100%" }}
                  />
                ))}
              </Stack>
            </Box>

            <Divider />

            <Stack direction="row" spacing={1.5}>
              <TextField
                select
                size="small"
                label="Jev reads"
                value={reads}
                onChange={(event) => setReads(event.target.value)}
                sx={{ flex: 1 }}
              >
                {Object.entries(READS).map(([value, option]) => (
                  <MenuItem key={value} value={value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="Traces"
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
                sx={{ width: 170 }}
              >
                {TRACE_LIMIT_OPTIONS.map((value) => (
                  <MenuItem key={value} value={value}>
                    {value} most recent
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Scope: the {limit} most recent traces matching this view ·{" "}
              {dateLabel || "current date range"}
              {filterCount
                ? ` · ${filterCount} filter${filterCount > 1 ? "s" : ""}`
                : ""}
            </Typography>

            <SavedEvals
              items={saved.items}
              isLoading={saved.isLoading}
              onToggle={onToggleAnswerFilter}
              isActive={isAnswerFilterActive}
              onRerun={handleRerun}
            />
          </Stack>
        ) : (
          <Stack spacing={2.5}>
            {isBusy && (
              <Box>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ mb: 1 }}
                >
                  <CircularProgress size={16} />
                  <Typography variant="body2">
                    {run.phase === "creating"
                      ? "Saving the questions as Jev evaluators…"
                      : run.total
                        ? `Jev is reading traces · ${processed} of ${run.total}`
                        : "Collecting the traces in this view…"}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant={run.total ? "determinate" : "indeterminate"}
                  value={progressValue}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 1, display: "block" }}
                >
                  You can close this panel. The run continues, and its answers
                  stay in this project.
                </Typography>
              </Box>
            )}

            {run.phase === "done" && (
              <Typography variant="subtitle2">
                {run.total
                  ? `Jev answered ${run.completed} of ${run.total} ${run.since ? "new " : ""}traces`
                  : run.since
                    ? "No new traces"
                    : "No traces matched this view"}
                {run.failed ? ` · ${run.failed} couldn't be evaluated` : ""}
              </Typography>
            )}
            {run.phase === "done" && run.failed > 0 && (
              <Alert severity="warning">
                {explainErrorGroups(run.errorGroups).map((entry, index) => (
                  <Box key={index} component="span" sx={{ display: "block" }}>
                    {entry.count} answer{entry.count === 1 ? "" : "s"}{" "}
                    {entry.reason}
                  </Box>
                ))}
                {!run.errorGroups?.length &&
                  `${run.failed} trace${run.failed === 1 ? "" : "s"} couldn't be evaluated.`}
              </Alert>
            )}
            {run.phase === "done" && !run.total && (
              <Alert severity={run.since ? "info" : "warning"}>
                {run.since
                  ? `No new traces have arrived since that run (${formatWhen(run.since)}). Rerun later to answer the traces that come in.`
                  : "There are no traces in this view for the selected date range and filters. Widen the date range or clear a filter, then run again."}
              </Alert>
            )}

            {run.items.map((item) => (
              <Box key={item.configId || item.question}>
                <Typography variant="overline" color="text.secondary">
                  {item.answerType === ANSWER_TYPES.CATEGORY
                    ? "Categories"
                    : "Yes / No"}
                </Typography>
                <Typography variant="body1" sx={{ mb: 1.25 }}>
                  {item.question}
                </Typography>
                {run.phase === "done" && run.total > 0 && (
                  <AnswerBars
                    item={item}
                    counts={run.counts?.[item.configId]}
                    onToggle={onToggleAnswerFilter}
                    isActive={isAnswerFilterActive}
                  />
                )}
              </Box>
            ))}

            {run.phase === "done" && run.total > 0 && (
              <>
                <Divider />
                <Stack spacing={1}>
                  {live.state === "idle" && (
                    <Button
                      variant="outlined"
                      startIcon={<Iconify icon="mdi:sync" width={16} />}
                      onClick={() => setLive({ state: "confirm" })}
                      sx={{
                        justifyContent: "flex-start",
                        textTransform: "none",
                      }}
                    >
                      Keep answering on new traces
                    </Button>
                  )}
                  {(live.state === "confirm" || live.state === "creating") && (
                    <Alert
                      severity="info"
                      action={
                        <Stack direction="row" spacing={0.5}>
                          <Button
                            size="small"
                            onClick={() => setLive({ state: "idle" })}
                            disabled={live.state === "creating"}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            onClick={handleKeepAnswering}
                            disabled={live.state === "creating"}
                          >
                            Start
                          </Button>
                        </Stack>
                      }
                    >
                      Jev will answer{" "}
                      {run.items.length > 1
                        ? `these ${run.items.length} questions`
                        : "this question"}{" "}
                      for every new trace that matches this view&apos;s
                      filters. Usage is billed as AI credits.
                    </Alert>
                  )}
                  {live.state === "done" && (
                    <Alert
                      severity="success"
                      action={
                        <Button
                          size="small"
                          onClick={() => onOpenTask(live.taskId)}
                        >
                          View task
                        </Button>
                      }
                    >
                      Live. New traces in this view will be answered as they
                      arrive.
                    </Alert>
                  )}
                  {live.state === "error" && (
                    <Alert
                      severity="error"
                      onClose={() => setLive({ state: "idle" })}
                    >
                      {live.error}
                    </Alert>
                  )}
                  {run.items.map((item, index) => (
                    <Button
                      key={item.templateId || index}
                      variant="text"
                      startIcon={
                        <Iconify icon="mdi:pencil-outline" width={16} />
                      }
                      onClick={() => onOpenEvaluator(item)}
                      sx={{
                        justifyContent: "flex-start",
                        textTransform: "none",
                      }}
                    >
                      {run.items.length > 1
                        ? `Edit evaluator for question ${index + 1}`
                        : "Edit the saved evaluator"}
                    </Button>
                  ))}
                </Stack>
              </>
            )}
          </Stack>
        )}
      </Box>

      <Divider />
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={2}
        sx={{ px: 2.5, py: 1.5 }}
      >
        <Typography variant="caption" color="text.secondary">
          Runs on Jev · each question is saved as an evaluator
        </Typography>
        {isEditing ? (
          <Button
            variant="contained"
            onClick={handleRun}
            disabled={!jev.allowed}
            startIcon={<Iconify icon="mdi:play" width={16} />}
            sx={{ whiteSpace: "nowrap", flexShrink: 0 }}
          >
            Run on {limit} traces
          </Button>
        ) : (
          <Button
            variant="outlined"
            onClick={() => {
              reset();
              setQuestions([emptyQuestion()]);
              setTouched(false);
            }}
            disabled={run.phase === "creating"}
          >
            Ask new questions
          </Button>
        )}
      </Stack>
    </Drawer>
  );
}

InstantEvalPanel.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  runApi: PropTypes.shape({
    run: PropTypes.object.isRequired,
    start: PropTypes.func.isRequired,
    rerun: PropTypes.func.isRequired,
    view: PropTypes.func.isRequired,
    reset: PropTypes.func.isRequired,
  }).isRequired,
  projectId: PropTypes.string,
  dateLabel: PropTypes.string,
  filterCount: PropTypes.number,
  getScopeFilters: PropTypes.func.isRequired,
  onToggleAnswerFilter: PropTypes.func.isRequired,
  isAnswerFilterActive: PropTypes.func.isRequired,
  onClearAnswerFilters: PropTypes.func.isRequired,
  hasAnswerFilters: PropTypes.bool,
  onOpenEvaluator: PropTypes.func.isRequired,
  onOpenTask: PropTypes.func.isRequired,
};
