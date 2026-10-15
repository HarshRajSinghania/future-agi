import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { getSafeActionErrorMessage } from "src/utils/errorUtils";
import { ANSWER_TYPES } from "src/sections/projects/LLMTracing/InstantEval/instantEvalPayloads";
import {
  createContinuousTask,
  explainErrorGroups,
  findContinuousTask,
} from "src/sections/projects/LLMTracing/InstantEval/useInstantEval";
import AnswerHeatmap from "./AnswerHeatmap";
import { tracePageLink, traceViewLink } from "./analyseScope";

// Categorical hues for category answers; the first is the brand accent.
const CATEGORY_COLORS = [
  "#7857FC",
  "#0EA5E9",
  "#F59E0B",
  "#10B981",
  "#EF4444",
  "#EC4899",
  "#14B8A6",
  "#8B5CF6",
  "#F97316",
  "#64748B",
];

const labelColor = (item, label, theme) => {
  if (item.answerType === ANSWER_TYPES.CATEGORY)
    return CATEGORY_COLORS[item.labels.indexOf(label) % CATEGORY_COLORS.length];
  return label === "Yes" ? theme.palette.primary.main : theme.palette.grey[500];
};

// The answer worth looking at first: "Yes" for yes/no questions, otherwise the
// most common category.
const defaultLabel = (item, counts) => {
  if (item.answerType !== ANSWER_TYPES.CATEGORY) return "Yes";
  return [...item.labels].sort(
    (a, b) => (counts?.[b] || 0) - (counts?.[a] || 0),
  )[0];
};

const formatTime = (value) =>
  new Date(value).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const duration = (from, to) => {
  const seconds = Math.max(
    0,
    Math.round((new Date(to) - new Date(from)) / 1000),
  );
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;
};

function AnswerBars({ item, counts, selected, onSelect, onShow, theme }) {
  const total = item.labels.reduce(
    (sum, label) => sum + (counts?.[label] || 0),
    0,
  );
  return (
    <Stack spacing={0.75}>
      {item.labels.map((label) => {
        const count = counts?.[label] || 0;
        const share = total ? (count / total) * 100 : 0;
        const active = selected === label;
        const color = labelColor(item, label, theme);
        return (
          <Box
            key={label}
            role="button"
            tabIndex={0}
            aria-pressed={active}
            aria-label={`${label}: ${count} traces, ${Math.round(share)}%`}
            onClick={() => onSelect(label)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(label);
              }
            }}
            sx={{
              p: 1,
              borderRadius: 1,
              cursor: "pointer",
              border: "1px solid",
              borderColor: active ? alpha(color, 0.6) : "transparent",
              bgcolor: active ? alpha(color, 0.06) : "transparent",
              "&:hover": { bgcolor: alpha(color, 0.06) },
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ minWidth: 0 }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "2px",
                    bgcolor: color,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2" fontWeight={600} noWrap>
                  {label}
                </Typography>
              </Stack>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ flexShrink: 0 }}
              >
                {count} · {Math.round(share)}%
              </Typography>
            </Stack>
            <Box
              sx={{
                mt: 0.75,
                height: 6,
                borderRadius: 1,
                bgcolor: alpha(color, 0.12),
              }}
            >
              <Box
                sx={{
                  width: `${share}%`,
                  height: "100%",
                  borderRadius: 1,
                  bgcolor: color,
                  transition: "width 500ms ease",
                }}
              />
            </Box>
            {active && count > 0 && (
              <Button
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  onShow(label);
                }}
                startIcon={<Iconify icon="mdi:filter-outline" width={14} />}
                sx={{ mt: 0.75, textTransform: "none", px: 0.5 }}
              >
                Show these {count} in the Trace view
              </Button>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}

AnswerBars.propTypes = {
  item: PropTypes.object.isRequired,
  counts: PropTypes.object,
  selected: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
  onShow: PropTypes.func.isRequired,
  theme: PropTypes.object.isRequired,
};

function Examples({ traces, item, label, projectId, navigate }) {
  const matches = traces.filter(
    (trace) => trace.answers?.[item.configId] === label,
  );
  if (!matches.length) return null;
  const shown = matches.slice(-6).reverse();
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Recent traces answered {label}
      </Typography>
      <Stack spacing={0.75}>
        {shown.map((trace) => (
          <Box
            key={trace.traceId}
            role="link"
            tabIndex={0}
            onClick={() => navigate(tracePageLink(projectId, trace.traceId))}
            onKeyDown={(event) => {
              if (event.key === "Enter")
                navigate(tracePageLink(projectId, trace.traceId));
            }}
            sx={{
              px: 1.5,
              py: 1,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              cursor: "pointer",
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <Stack direction="row" spacing={1.5} alignItems="baseline">
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ flexShrink: 0, width: 132 }}
              >
                {formatTime(trace.time)}
              </Typography>
              <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                {trace.input || "(no input)"}
              </Typography>
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

Examples.propTypes = {
  traces: PropTypes.array.isRequired,
  item: PropTypes.object.isRequired,
  label: PropTypes.string,
  projectId: PropTypes.string.isRequired,
  navigate: PropTypes.func.isRequired,
};

function KeepAnswering({ projectId, run, navigate }) {
  const [state, setState] = useState({ step: "idle" });
  const start = async () => {
    setState({ step: "working" });
    try {
      const existing = await findContinuousTask({
        projectId,
        items: run.items,
      });
      if (existing) {
        setState({ step: "done", taskId: existing.id, existed: true });
        return;
      }
      const taskId = await createContinuousTask({
        projectId,
        items: run.items,
        scopeFilters: run.scopeFilters || [],
      });
      setState({ step: "done", taskId });
    } catch (error) {
      setState({
        step: "error",
        error: getSafeActionErrorMessage(
          error,
          "The live task could not be created.",
        ),
      });
    }
  };
  if (state.step === "done")
    return (
      <Alert
        severity="success"
        action={
          <Button
            size="small"
            onClick={() => navigate(`/dashboard/tasks/${state.taskId}`)}
          >
            View task
          </Button>
        }
      >
        {state.existed
          ? "These questions are already being answered for new traces."
          : "Live. New traces that match this scope will be answered as they arrive."}
      </Alert>
    );
  if (state.step === "confirm" || state.step === "working")
    return (
      <Alert
        severity="info"
        action={
          <Stack direction="row" spacing={0.5}>
            <Button
              size="small"
              disabled={state.step === "working"}
              onClick={() => setState({ step: "idle" })}
            >
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={state.step === "working"}
              onClick={start}
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
        for every new trace that matches this scope&apos;s filters, the same way
        your other Jev evaluators run.
      </Alert>
    );
  return (
    <>
      {state.step === "error" && (
        <Alert
          severity="error"
          onClose={() => setState({ step: "idle" })}
          sx={{ mb: 1 }}
        >
          {state.error}
        </Alert>
      )}
      <Button
        variant="outlined"
        startIcon={<Iconify icon="mdi:sync" width={16} />}
        onClick={() => setState({ step: "confirm" })}
        sx={{ textTransform: "none" }}
      >
        Keep answering new traces
      </Button>
    </>
  );
}

KeepAnswering.propTypes = {
  projectId: PropTypes.string.isRequired,
  run: PropTypes.object.isRequired,
  navigate: PropTypes.func.isRequired,
};

export default function RunResults({ projectId, run, navigate }) {
  const theme = useTheme();
  const [questionIndex, setQuestionIndex] = useState(0);
  const [mode, setMode] = useState("count");
  const [selectedLabel, setSelectedLabel] = useState(null);
  const items = run.items || [];
  const item = items[Math.min(questionIndex, Math.max(0, items.length - 1))];
  const counts = item ? run.counts?.[item.configId] : undefined;
  const isRunning = run.phase === "running" || run.phase === "creating";
  const traces = run.traces || [];
  const label =
    selectedLabel && item?.labels.includes(selectedLabel)
      ? selectedLabel
      : item
        ? defaultLabel(item, counts)
        : null;

  useEffect(() => {
    setQuestionIndex(0);
    setSelectedLabel(null);
  }, [run.taskId]);
  useEffect(() => setSelectedLabel(null), [questionIndex]);

  const window = useMemo(() => {
    const range = (run.scopeFilters || []).find(
      (filter) =>
        filter.column_id === "created_at" &&
        filter.filter_config?.filter_op === "between",
    )?.filter_config?.filter_value;
    return range;
  }, [run.scopeFilters]);

  if (!item) return null;

  const processed = (run.completed || 0) + (run.failed || 0);
  const answered = item.labels.reduce(
    (sum, entry) => sum + (counts?.[entry] || 0),
    0,
  );

  const showInTraceView = (labels, cellWindow) =>
    navigate(
      traceViewLink({
        projectId,
        scopeFilters: run.scopeFilters,
        window: cellWindow,
        item,
        labels,
      }),
    );

  return (
    <Stack spacing={2}>
      <Box>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          {isRunning ? (
            <Typography variant="body2" color="text.secondary">
              {run.phase === "creating"
                ? "Saving the questions as Jev evaluators…"
                : run.total
                  ? `Jev is reading traces · ${Math.min(processed, run.total)} of ${run.total}`
                  : "Collecting the traces in scope…"}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {run.total
                ? `${answered} of ${traces.length || run.total} traces answered${
                    run.startedAt && run.finishedAt && !run.viewing
                      ? ` in ${duration(run.startedAt, run.finishedAt)}`
                      : ""
                  }${run.viewing && run.startedAt ? ` · run on ${formatTime(run.startedAt)}` : ""}`
                : run.since
                  ? "No new traces have arrived since that run."
                  : "No traces matched this scope."}
            </Typography>
          )}
        </Stack>
        {isRunning && (
          <LinearProgress
            variant={run.total ? "determinate" : "indeterminate"}
            value={
              run.total
                ? Math.min(100, (processed / run.total) * 100)
                : undefined
            }
            sx={{ height: 4, borderRadius: 2 }}
          />
        )}
      </Box>

      {run.error && <Alert severity="warning">{run.error}</Alert>}
      {run.phase === "done" && run.failed > 0 && (
        <Alert severity="warning">
          {explainErrorGroups(run.errorGroups).map((entry, index) => (
            <Box key={index} component="span" sx={{ display: "block" }}>
              {entry.count} answer{entry.count === 1 ? "" : "s"} {entry.reason}
            </Box>
          ))}
          {!run.errorGroups?.length &&
            `${run.failed} traces couldn't be evaluated.`}
        </Alert>
      )}

      {items.length > 1 && (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {items.map((entry, index) => (
            <Chip
              key={entry.configId || index}
              label={`${index + 1}. ${entry.question}`}
              color={index === questionIndex ? "primary" : "default"}
              variant={index === questionIndex ? "filled" : "outlined"}
              onClick={() => setQuestionIndex(index)}
              sx={{ maxWidth: 420 }}
            />
          ))}
        </Stack>
      )}

      <Box
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1.5,
          p: 2.5,
          bgcolor: "background.paper",
        }}
      >
        <Stack
          direction="row"
          alignItems="baseline"
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 2 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary">
              {item.answerType === ANSWER_TYPES.CATEGORY
                ? "Categories"
                : "Yes / No"}
            </Typography>
            <Typography variant="h6">{item.question}</Typography>
          </Box>
          {item.templateId && (
            <Button
              size="small"
              startIcon={<Iconify icon="mdi:pencil-outline" width={14} />}
              onClick={() =>
                navigate(`/dashboard/evaluations/${item.templateId}`)
              }
              sx={{ textTransform: "none", flexShrink: 0 }}
            >
              Edit evaluator
            </Button>
          )}
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "300px 1fr" },
            gap: 3,
            alignItems: "start",
          }}
        >
          <AnswerBars
            item={item}
            counts={counts}
            selected={label}
            onSelect={setSelectedLabel}
            onShow={(value) => showInTraceView([value])}
            theme={theme}
          />
          <AnswerHeatmap
            traces={traces}
            configId={item.configId}
            label={label}
            window={window}
            mode={mode}
            onModeChange={setMode}
            isRunning={isRunning}
            color={labelColor(item, label, theme)}
            onSelectCell={(date, hour) => {
              const start = new Date(
                date.getFullYear(),
                date.getMonth(),
                date.getDate(),
                hour,
              );
              const end = new Date(start.getTime() + 3600 * 1000);
              showInTraceView(
                [label],
                [start.toISOString(), end.toISOString()],
              );
            }}
          />
        </Box>
      </Box>

      <Examples
        traces={traces}
        item={item}
        label={label}
        projectId={projectId}
        navigate={navigate}
      />

      {run.phase === "done" && run.total > 0 && !run.since && (
        <Box>
          <KeepAnswering projectId={projectId} run={run} navigate={navigate} />
        </Box>
      )}
    </Stack>
  );
}

RunResults.propTypes = {
  projectId: PropTypes.string.isRequired,
  run: PropTypes.object.isRequired,
  navigate: PropTypes.func.isRequired,
};
