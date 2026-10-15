import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useLocation, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import Iconify from "src/components/iconify";
import { endpoints, readQuery } from "src/utils/axios";
import QuestionEditor from "src/sections/projects/LLMTracing/InstantEval/QuestionEditor";
import {
  ANSWER_TYPES,
  MAX_QUESTIONS,
  READS,
  TRACE_LIMIT_OPTIONS,
  validateInstantEval,
} from "src/sections/projects/LLMTracing/InstantEval/instantEvalPayloads";
import { useJevAvailability } from "src/sections/projects/LLMTracing/InstantEval/useJevAvailability";
import {
  buildAnswerFilter,
  useInstantEvalHistory,
  useInstantEvalRun,
  useInstantEvals,
} from "src/sections/projects/LLMTracing/InstantEval/useInstantEval";
import DiscoverComposer from "./DiscoverComposer";
import RunResults from "./RunResults";
import {
  DATE_PRESETS,
  describeFilter,
  isDateItem,
  presetScope,
  readScope,
} from "./analyseScope";

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

const LATE_ARRIVAL_OVERLAP_MS = 5 * 60 * 1000;

const STATUS_DOT = {
  completed: "success.main",
  running: "info.main",
  pending: "info.main",
  failed: "error.main",
  paused: "warning.main",
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

// Exact count when the list can prove it; otherwise the list's fast estimate,
// which is a lower bound and is labelled as one.
// The trace list proves totals only within the rows it reads, so count by
// reading as many traces as a run can take: anything beyond that shows as
// "500+", which is all the composer needs to know.
const COUNT_PAGE_SIZE = Math.max(...TRACE_LIMIT_OPTIONS);
const MODE_PARAM = "mode";

function useScopeCount(projectId, filters) {
  return useQuery({
    queryKey: ["analyse-scope-count", projectId, JSON.stringify(filters)],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const response = await readQuery(
        endpoints.project.getTracesForObserveProject(),
        {
          params: {
            project_id: projectId,
            page_number: 0,
            page_size: COUNT_PAGE_SIZE,
            filters: JSON.stringify(filters),
          },
        },
      );
      const metadata = response?.data?.result?.metadata || {};
      const total = Number(metadata.total_rows);
      if (!Number.isFinite(total)) return null;
      return {
        total,
        isLowerBound:
          metadata.total_rows_is_lower_bound === true ||
          metadata.has_more === true,
        // Discover samples from these, so it reads exactly the scope's traces.
        traces: (response?.data?.result?.table || []).map((row) => ({
          traceId: row.trace_id,
          time: row.start_time || row.created_at,
        })),
      };
    },
    meta: { errorHandled: true },
    staleTime: 30_000,
  });
}

const formatScopeTotal = ({ total, isLowerBound }) =>
  `${total.toLocaleString()}${isLowerBound ? "+" : ""}`;

function HistoryRail({
  runs,
  isLoading,
  activeTaskId,
  onNew,
  onView,
  onRerunNew,
}) {
  return (
    <Box
      sx={{
        width: 280,
        flexShrink: 0,
        borderRight: "1px solid",
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Box sx={{ p: 1.5 }}>
        <Button
          fullWidth
          variant="contained"
          startIcon={<Iconify icon="mdi:plus" width={16} />}
          onClick={onNew}
          sx={{ textTransform: "none" }}
        >
          New question
        </Button>
      </Box>
      <Typography variant="overline" color="text.secondary" sx={{ px: 2 }}>
        History
      </Typography>
      <Box sx={{ flex: 1, overflowY: "auto", px: 1, pb: 2 }}>
        {isLoading && <LinearProgress sx={{ m: 1 }} />}
        {!isLoading && !runs.length && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", px: 1, py: 1 }}
          >
            Every run is kept here so you can reopen its answers or ask the same
            questions about new traces.
          </Typography>
        )}
        {runs.map((runItem) => {
          const active = runItem.taskId === activeTaskId;
          return (
            <Box
              key={runItem.taskId}
              role="button"
              tabIndex={0}
              aria-current={active ? "true" : undefined}
              onClick={() => onView(runItem)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onView(runItem);
              }}
              sx={{
                px: 1.25,
                py: 1,
                mb: 0.5,
                borderRadius: 1,
                cursor: "pointer",
                bgcolor: active ? "action.selected" : "transparent",
                "&:hover": {
                  bgcolor: active ? "action.selected" : "action.hover",
                },
                "&:hover .rerun": { opacity: 1 },
              }}
            >
              <Stack
                direction="row"
                alignItems="center"
                spacing={0.75}
                sx={{ mb: 0.25 }}
              >
                <Box
                  sx={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    bgcolor: STATUS_DOT[runItem.status] || "text.disabled",
                    flexShrink: 0,
                  }}
                />
                <Typography variant="caption" color="text.secondary" noWrap>
                  {formatWhen(runItem.createdAt)}
                  {runItem.items.length > 1
                    ? ` · ${runItem.items.length} questions`
                    : ""}
                </Typography>
              </Stack>
              <Typography
                variant="body2"
                sx={{
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {runItem.items[0]?.question}
              </Typography>
              <Button
                className="rerun"
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  onRerunNew(runItem);
                }}
                startIcon={<Iconify icon="mdi:update" width={14} />}
                sx={{
                  mt: 0.25,
                  px: 0.5,
                  textTransform: "none",
                  opacity: active ? 1 : 0,
                  transition: "opacity 120ms",
                }}
              >
                Ask about new traces
              </Button>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

HistoryRail.propTypes = {
  runs: PropTypes.array.isRequired,
  isLoading: PropTypes.bool,
  activeTaskId: PropTypes.string,
  onNew: PropTypes.func.isRequired,
  onView: PropTypes.func.isRequired,
  onRerunNew: PropTypes.func.isRequired,
};

function ScopeBar({ scope, onPreset, onRemoveFilter, count }) {
  const otherFilters = scope.filters.filter((filter) => !isDateItem(filter));
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      flexWrap="wrap"
      useFlexGap
    >
      <Typography variant="body2" color="text.secondary">
        Scope
      </Typography>
      <TextField
        select
        size="small"
        value={scope.preset}
        onChange={(event) => onPreset(event.target.value)}
        sx={{ minWidth: 180, "& .MuiInputBase-input": { py: 0.75 } }}
        inputProps={{ "aria-label": "Date range" }}
      >
        {scope.preset === "trace" && (
          <MenuItem value="trace">{scope.label}</MenuItem>
        )}
        {DATE_PRESETS.map((preset) => (
          <MenuItem key={preset.value} value={preset.value}>
            {preset.label}
          </MenuItem>
        ))}
      </TextField>
      {otherFilters.map((filter, index) => (
        <Chip
          key={`${filter.column_id}-${index}`}
          size="small"
          label={describeFilter(filter)}
          title={describeFilter(filter)}
          onDelete={() => onRemoveFilter(filter)}
          sx={{ maxWidth: 360 }}
        />
      ))}
      <Typography variant="caption" color="text.secondary">
        {count.isLoading
          ? "Counting traces…"
          : count.data
            ? `${formatScopeTotal(count.data)} trace${count.data.total === 1 && !count.data.isLowerBound ? "" : "s"} in scope`
            : ""}
      </Typography>
    </Stack>
  );
}

ScopeBar.propTypes = {
  scope: PropTypes.object.isRequired,
  onPreset: PropTypes.func.isRequired,
  onRemoveFilter: PropTypes.func.isRequired,
  count: PropTypes.object.isRequired,
};

function Composer({ onRun, scopeCount, disabled }) {
  const [questions, setQuestions] = useState([emptyQuestion()]);
  const [reads, setReads] = useState("input_output");
  const [limit, setLimit] = useState(100);
  const [touched, setTouched] = useState(false);
  const errors = questions.map((question) => validateInstantEval(question));

  const applyExample = (example) =>
    setQuestions((prev) => {
      const blank = prev.findIndex((question) => !question.question.trim());
      if (blank >= 0)
        return prev.map((q, i) => (i === blank ? { ...example } : q));
      if (prev.length >= MAX_QUESTIONS) return prev;
      return [...prev, { ...example }];
    });

  const run = () => {
    setTouched(true);
    if (errors.some(Boolean)) return;
    onRun({ questions, reads, limit });
  };

  const covered =
    scopeCount && !scopeCount.isLowerBound
      ? Math.min(scopeCount.total, limit)
      : limit;

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1.5,
        bgcolor: "background.paper",
        p: 2.5,
      }}
    >
      <Typography variant="h6">Ask about your traces</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Write questions in plain English. Jev answers each one for every trace
        in scope, shows you when the answers happen, and every answer becomes a
        filter in the Trace view.
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "1fr 300px" },
          gap: 2.5,
          alignItems: "start",
        }}
      >
        <Stack spacing={1.5}>
          {questions.map((value, index) => (
            <QuestionEditor
              key={index}
              index={index}
              value={value}
              autoFocus={index === questions.length - 1}
              error={touched ? errors[index] : null}
              onChange={(next) =>
                setQuestions((prev) =>
                  prev.map((q, i) => (i === index ? next : q)),
                )
              }
              onRemove={
                questions.length > 1
                  ? () =>
                      setQuestions((prev) => prev.filter((_, i) => i !== index))
                  : undefined
              }
            />
          ))}
          <Stack direction="row" alignItems="center" spacing={1}>
            <Button
              size="small"
              startIcon={<Iconify icon="mdi:plus" width={16} />}
              disabled={questions.length >= MAX_QUESTIONS}
              onClick={() => setQuestions((prev) => [...prev, emptyQuestion()])}
              sx={{ textTransform: "none" }}
            >
              Add another question
            </Button>
            <Typography variant="caption" color="text.secondary">
              Up to {MAX_QUESTIONS} in one pass
            </Typography>
          </Stack>
        </Stack>

        <Stack spacing={2}>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 0.75 }}
            >
              Try one
            </Typography>
            <Stack spacing={0.75} alignItems="flex-start">
              {EXAMPLES.map((example) => (
                <Chip
                  key={example.question}
                  size="small"
                  variant="outlined"
                  label={example.question}
                  onClick={() => applyExample(example)}
                  sx={{
                    maxWidth: "100%",
                    height: "auto",
                    "& .MuiChip-label": { whiteSpace: "normal", py: 0.5 },
                  }}
                />
              ))}
            </Stack>
          </Box>
          <TextField
            select
            size="small"
            label="Jev reads"
            value={reads}
            onChange={(event) => setReads(event.target.value)}
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
            helperText={
              scopeCount &&
              (scopeCount.isLowerBound || scopeCount.total > limit)
                ? `The newest ${limit} of ${formatScopeTotal(scopeCount)} traces in scope`
                : "The newest traces in scope"
            }
          >
            {TRACE_LIMIT_OPTIONS.map((value) => (
              <MenuItem key={value} value={value}>
                Up to {value}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            size="large"
            disabled={disabled}
            onClick={run}
            startIcon={<Iconify icon="mdi:play" width={18} />}
            sx={{ textTransform: "none" }}
          >
            Ask Jev about {covered.toLocaleString()} trace
            {covered === 1 ? "" : "s"}
          </Button>
          <Typography variant="caption" color="text.secondary">
            Each question is saved as a Jev evaluator you can reuse, edit or run
            on new traces.
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
}

Composer.propTypes = {
  onRun: PropTypes.func.isRequired,
  scopeCount: PropTypes.shape({
    total: PropTypes.number,
    isLowerBound: PropTypes.bool,
  }),
  disabled: PropTypes.bool,
};

export default function AnalyseView() {
  const { observeId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const jev = useJevAvailability();
  const [scope, setScope] = useState(() => readScope(location.search));
  const mode =
    new URLSearchParams(location.search).get(MODE_PARAM) === "discover"
      ? "discover"
      : "ask";
  const setMode = (next) => {
    const params = new URLSearchParams(location.search);
    params.set(MODE_PARAM, next);
    navigate(`${location.pathname}?${params.toString()}`, { replace: true });
  };
  const [composerKey, setComposerKey] = useState(0);
  const [discoverFocus, setDiscoverFocus] = useState(null);
  const runApi = useInstantEvalRun(observeId);
  const { run, start, rerun, view, reset } = runApi;
  const saved = useInstantEvals(observeId, { enabled: jev.available });
  const configsByName = useMemo(
    () =>
      Object.fromEntries((saved.all || []).map((item) => [item.name, item])),
    [saved.all],
  );
  const history = useInstantEvalHistory(observeId, configsByName, {
    enabled: jev.available,
  });
  const count = useScopeCount(observeId, scope.filters);

  useEffect(() => {
    if (run.phase === "done") {
      saved.refetch?.();
      history.refetch?.();
    }
    // Refresh the history once per finished run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.phase]);

  const setPreset = (preset) => {
    if (preset === "trace") return;
    setScope((prev) =>
      presetScope(
        preset,
        prev.filters.filter((filter) => !isDateItem(filter)),
      ),
    );
  };

  const removeFilter = (target) =>
    setScope((prev) => ({
      ...prev,
      filters: prev.filters.filter((filter) => filter !== target),
    }));

  const startRun = ({ questions, reads, limit }) =>
    start({ questions, reads, limit, scope: { scopeFilters: scope.filters } });

  const viewRun = (runItem) =>
    view({
      taskId: runItem.taskId,
      items: runItem.items,
      scopeFilters: runItem.scopeFilters,
      startedAt: runItem.createdAt,
    });

  // Traces that arrived after that run: same filters, a window starting where
  // that run's window ended, with a small overlap for traces stored late.
  const rerunNew = (runItem) => {
    const previousEnd = Math.min(
      new Date(runItem.dateRange?.[1] || runItem.createdAt).getTime(),
      new Date(runItem.createdAt).getTime(),
    );
    const window = [
      new Date(previousEnd - LATE_ARRIVAL_OVERLAP_MS),
      new Date(),
    ];
    const scopeFilters = [
      ...runItem.scopeFilters.filter((filter) => !isDateItem(filter)),
      {
        column_id: "created_at",
        filter_config: {
          filter_type: "datetime",
          filter_op: "between",
          filter_value: window.map((date) => date.toISOString()),
        },
      },
    ];
    rerun({
      items: runItem.items,
      limit: 500,
      scope: { scopeFilters, since: runItem.createdAt },
    });
  };

  const newQuestion = () => {
    reset();
    setDiscoverFocus(null);
    setComposerKey((key) => key + 1);
  };

  // A second level of categories: Discover again, scoped to the traces that
  // got this answer in this run.
  const breakDown = (item, label) => {
    setScope({
      filters: [...(run.scopeFilters || []), buildAnswerFilter(item, [label])],
      label: "Same window as this run",
      preset: "trace",
    });
    setDiscoverFocus(
      `What distinct kinds of "${label}" are there, and how do they differ?`,
    );
    reset();
    setComposerKey((key) => key + 1);
    setMode("discover");
  };

  const showComposer = run.phase === "idle" || run.phase === "failed";

  return (
    <Box sx={{ display: "flex", height: "100%", minHeight: 0 }}>
      {jev.available && (
        <HistoryRail
          runs={history.runs}
          isLoading={history.isLoading}
          activeTaskId={run.taskId}
          onNew={newQuestion}
          onView={viewRun}
          onRerunNew={rerunNew}
        />
      )}
      <Box sx={{ flex: 1, minWidth: 0, overflowY: "auto", px: 3, py: 2.5 }}>
        <Stack spacing={2.5} sx={{ maxWidth: 1240 }}>
          {jev.isLoading ? (
            <LinearProgress />
          ) : !jev.available ? (
            <Alert severity="info">{jev.reason}</Alert>
          ) : (
            <>
              {showComposer && (
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={mode}
                  onChange={(_, next) => next && setMode(next)}
                  aria-label="Analyse mode"
                  sx={{ alignSelf: "flex-start" }}
                >
                  <ToggleButton
                    value="ask"
                    sx={{ textTransform: "none", px: 2 }}
                  >
                    <Iconify
                      icon="mdi:comment-question-outline"
                      width={16}
                      sx={{ mr: 0.75 }}
                    />
                    Ask a question
                  </ToggleButton>
                  <ToggleButton
                    value="discover"
                    sx={{ textTransform: "none", px: 2 }}
                  >
                    <Iconify
                      icon="mdi:shape-outline"
                      width={16}
                      sx={{ mr: 0.75 }}
                    />
                    Discover categories
                  </ToggleButton>
                </ToggleButtonGroup>
              )}
              {showComposer && (
                <ScopeBar
                  scope={scope}
                  onPreset={setPreset}
                  onRemoveFilter={removeFilter}
                  count={count}
                />
              )}
              {run.phase === "failed" && (
                <Alert severity="error" onClose={reset}>
                  {run.error}
                </Alert>
              )}
              {showComposer && mode === "discover" ? (
                <DiscoverComposer
                  key={`discover-${composerKey}`}
                  projectId={observeId}
                  scopeTraces={count.data?.traces}
                  scopeCount={count.data}
                  scopeLoading={count.isLoading}
                  onRun={startRun}
                  disabled={!jev.available}
                  initialFocus={discoverFocus}
                />
              ) : showComposer ? (
                <Composer
                  key={composerKey}
                  onRun={startRun}
                  scopeCount={count.data}
                  disabled={!jev.available}
                />
              ) : (
                <>
                  <Stack direction="row" justifyContent="flex-end">
                    <Button
                      size="small"
                      startIcon={<Iconify icon="mdi:plus" width={14} />}
                      onClick={newQuestion}
                      disabled={run.phase === "creating"}
                      sx={{ textTransform: "none" }}
                    >
                      New question
                    </Button>
                  </Stack>
                  <RunResults
                    projectId={observeId}
                    run={run}
                    navigate={navigate}
                    onBreakDown={breakDown}
                  />
                </>
              )}
            </>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
