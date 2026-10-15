import React, { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Box, Button, Stack, Tooltip, Typography } from "@mui/material";
import { alpha, keyframes, useTheme } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { ANSWER_TYPES } from "./instantEvalPayloads";

const ROWS = 7;
const CELL = 12;
const GAP = 3;
// Date labels are ~5 squares wide; skip one that would overlap its neighbour.
const MIN_LABEL_COLUMNS = 5;

// Transform only: an opacity keyframe held by fill-mode would override the
// dimming applied to squares outside the active answer filters.
const fillIn = keyframes`
  from { transform: scale(0.35); }
  60% { transform: scale(1.15); }
  to { transform: scale(1); }
`;
const scan = keyframes`
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.9; }
`;
const livePulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(120, 87, 252, 0.45); }
  70% { box-shadow: 0 0 0 6px rgba(120, 87, 252, 0); }
  100% { box-shadow: 0 0 0 0 rgba(120, 87, 252, 0); }
`;

// Distinct, colour-blind-aware categorical hues (first is the brand accent).
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

export function answerColors(item, theme) {
  if (item.answerType === ANSWER_TYPES.CATEGORY) {
    return Object.fromEntries(
      item.labels.map((label, index) => [
        label,
        CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      ]),
    );
  }
  return {
    Yes: theme.palette.primary.main,
    No: theme.palette.mode === "dark" ? "#4B5563" : "#CBD5E1",
  };
}

const formatTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatDay = (value) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

const formatDuration = (from, to) => {
  const seconds = Math.max(
    0,
    Math.round((new Date(to) - new Date(from)) / 1000),
  );
  if (!Number.isFinite(seconds)) return "";
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;
};

function LegendItem({ color, label, count, total, active, dimmed, onClick }) {
  const share = total ? Math.round((count / total) * 100) : 0;
  const content = (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.75}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (onClick && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick();
        }
      }}
      aria-pressed={onClick ? Boolean(active) : undefined}
      aria-label={`${label}: ${count} trace${count === 1 ? "" : "s"}`}
      sx={{
        px: 0.75,
        py: 0.25,
        borderRadius: 1,
        cursor: onClick ? "pointer" : "default",
        opacity: dimmed ? 0.45 : 1,
        border: "1px solid",
        borderColor: active ? "primary.main" : "transparent",
        bgcolor: active ? (theme) => alpha(theme.palette.primary.main, 0.08) : "transparent",
        "&:hover": onClick ? { bgcolor: "action.hover" } : undefined,
      }}
    >
      <Box
        sx={{ width: 10, height: 10, borderRadius: "2px", bgcolor: color, flexShrink: 0 }}
      />
      <Typography variant="caption" fontWeight={600} noWrap>
        {label}
      </Typography>
      <Typography variant="caption" color="text.secondary" noWrap>
        {count}
        {total ? ` · ${share}%` : ""}
      </Typography>
    </Stack>
  );
  return onClick ? (
    <Tooltip
      describeChild
      title={active ? "Stop filtering the grid by this answer" : "Filter the grid to this answer"}
    >
      {content}
    </Tooltip>
  ) : (
    content
  );
}

LegendItem.propTypes = {
  color: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  count: PropTypes.number,
  total: PropTypes.number,
  active: PropTypes.bool,
  dimmed: PropTypes.bool,
  onClick: PropTypes.func,
};

export default function InstantEvalMap({
  run,
  onToggleAnswerFilter,
  isAnswerFilterActive,
  onOpenTrace,
  onShowGraph,
  onOpenPanel,
}) {
  const theme = useTheme();
  const [questionIndex, setQuestionIndex] = useState(0);
  const [hovered, setHovered] = useState(null);
  const scroller = useRef(null);
  const items = run.items || [];
  const item = items[Math.min(questionIndex, items.length - 1)];
  const isRunning = run.phase === "running" || run.phase === "creating";

  useEffect(() => {
    if (questionIndex >= items.length) setQuestionIndex(0);
  }, [items.length, questionIndex]);

  // Keep the newest traces in view as the grid grows.
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, [run.traces?.length]);

  const traces = useMemo(() => {
    const all = run.traces || [];
    // A past run opened from History has no row limit; show what it answered.
    if (!run.viewing || !item) return all;
    return all.filter((trace) => trace.answers?.[item.configId] !== undefined);
  }, [run.traces, run.viewing, item]);

  const colors = useMemo(
    () => (item ? answerColors(item, theme) : {}),
    [item, theme],
  );
  const activeLabels = useMemo(
    () =>
      item ? item.labels.filter((label) => isAnswerFilterActive(item.configId, label)) : [],
    [item, isAnswerFilterActive],
  );
  // The grid keeps a trace only if it passes every active answer filter, so
  // a square dims when any question's filter excludes it.
  const activeFilters = useMemo(
    () =>
      items
        .map((entry) => ({
          configId: entry.configId,
          labels: entry.labels.filter((label) =>
            isAnswerFilterActive(entry.configId, label),
          ),
        }))
        .filter((filter) => filter.labels.length > 0),
    [items, isAnswerFilterActive],
  );

  const columns = Math.max(1, Math.ceil(traces.length / ROWS));
  const dayMarkers = useMemo(() => {
    const markers = [];
    let previous = "";
    for (let column = 0; column < columns; column += 1) {
      const trace = traces[column * ROWS];
      if (!trace) continue;
      const day = new Date(trace.time).toDateString();
      const last = markers[markers.length - 1];
      if (day !== previous && (!last || column - last.column >= MIN_LABEL_COLUMNS)) {
        markers.push({ column, label: formatDay(trace.time) });
      }
      previous = day;
    }
    return markers;
  }, [traces, columns]);

  if (!item) return null;

  const counts = run.counts?.[item.configId] || {};
  const answered = item.labels.reduce((sum, label) => sum + (counts[label] || 0), 0);
  const errors = counts.__errors || 0;
  const pending = Math.max(0, traces.length - answered - errors);
  const processed = (run.completed || 0) + (run.failed || 0);

  const status = isRunning
    ? run.total
      ? `Jev is reading traces · ${Math.min(processed, run.total)} of ${run.total}`
      : "Collecting the traces in this view…"
    : run.phase === "done"
      ? `${answered} trace${answered === 1 ? "" : "s"} answered${
          run.startedAt && run.finishedAt && !run.viewing
            ? ` in ${formatDuration(run.startedAt, run.finishedAt)}`
            : ""
        }${run.viewing && run.startedAt ? ` · run on ${formatTime(run.startedAt)}` : ""}`
      : run.phase === "failed"
        ? run.error || "This run failed."
        : "";

  const hoveredTrace = hovered != null ? traces[hovered] : null;
  const hoveredAnswer = hoveredTrace?.answers?.[item.configId];

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        px: 2,
        pt: 1.5,
        pb: 1.25,
        mb: 1,
        bgcolor: "background.paper",
      }}
      aria-label="Instant eval answer map"
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={2}
        sx={{ mb: 1 }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              flexShrink: 0,
              bgcolor: isRunning ? "primary.main" : run.phase === "failed" ? "error.main" : "success.main",
              animation: isRunning ? `${livePulse} 1.6s infinite` : "none",
            }}
          />
          <Typography variant="subtitle2" noWrap sx={{ minWidth: 0 }}>
            {item.question}
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
          <Typography variant="caption" color="text.secondary" noWrap>
            {status}
          </Typography>
          {onOpenPanel && (
            <Button
              size="small"
              onClick={onOpenPanel}
              startIcon={<Iconify icon="mdi:creation-outline" width={14} />}
              sx={{ textTransform: "none" }}
            >
              Instant eval
            </Button>
          )}
          <Tooltip title="Show the latency and traffic graph instead">
            <Button
              size="small"
              onClick={onShowGraph}
              startIcon={<Iconify icon="mdi:chart-line" width={14} />}
              sx={{ textTransform: "none" }}
            >
              Graph
            </Button>
          </Tooltip>
        </Stack>
      </Stack>

      {items.length > 1 && (
        <Stack direction="row" spacing={0.5} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
          {items.map((entry, index) => (
            <Button
              key={entry.configId || index}
              size="small"
              variant={index === questionIndex ? "contained" : "text"}
              onClick={() => setQuestionIndex(index)}
              sx={{ textTransform: "none", py: 0, px: 1, minWidth: 0, maxWidth: 360 }}
            >
              <Typography variant="caption" noWrap fontWeight={600}>
                {index + 1}. {entry.question}
              </Typography>
            </Button>
          ))}
        </Stack>
      )}

      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.25 }}>
        {item.labels.map((label) => (
          <LegendItem
            key={label}
            color={colors[label]}
            label={label}
            count={counts[label] || 0}
            total={answered}
            active={activeLabels.includes(label)}
            dimmed={activeLabels.length > 0 && !activeLabels.includes(label)}
            onClick={item.configId ? () => onToggleAnswerFilter(item, label) : undefined}
          />
        ))}
        {pending > 0 && (
          <LegendItem
            color={alpha(theme.palette.text.disabled, 0.35)}
            label={isRunning ? "Waiting" : "Not answered"}
            count={pending}
          />
        )}
        {errors > 0 && (
          <LegendItem color={theme.palette.warning.main} label="Couldn't evaluate" count={errors} />
        )}
      </Stack>

      <Box ref={scroller} sx={{ overflowX: "auto", pb: 0.5 }}>
        <Box sx={{ display: "inline-block", position: "relative", pb: 2.25 }}>
          <Box
            role="grid"
            aria-label={`${traces.length} traces, oldest to newest`}
            sx={{
              display: "grid",
              gridAutoFlow: "column",
              gridTemplateRows: `repeat(${ROWS}, ${CELL}px)`,
              gridAutoColumns: `${CELL}px`,
              gap: `${GAP}px`,
            }}
            onMouseLeave={() => setHovered(null)}
          >
            {traces.map((trace, index) => {
              const answer = trace.answers?.[item.configId];
              const isAnswered = answer !== undefined && answer !== "error";
              const color =
                answer === "error"
                  ? theme.palette.warning.main
                  : isAnswered
                    ? colors[answer] || theme.palette.text.secondary
                    : alpha(theme.palette.text.disabled, 0.25);
              const dim = activeFilters.some(
                (filter) => !filter.labels.includes(trace.answers?.[filter.configId]),
              );
              return (
                <Box
                  key={`${trace.traceId}-${answer ?? "pending"}`}
                  role="gridcell"
                  tabIndex={-1}
                  aria-label={`${formatTime(trace.time)}: ${answer ?? "waiting"}`}
                  onMouseEnter={() => setHovered(index)}
                  onClick={() => onOpenTrace(trace.traceId)}
                  sx={{
                    width: CELL,
                    height: CELL,
                    borderRadius: "3px",
                    bgcolor: color,
                    cursor: "pointer",
                    opacity: dim ? 0.18 : 1,
                    outline: hovered === index ? `2px solid ${theme.palette.text.primary}` : "none",
                    outlineOffset: 1,
                    transition: "opacity 200ms ease",
                    animation: isAnswered || answer === "error"
                      ? `${fillIn} 420ms cubic-bezier(.2,.8,.2,1) both`
                      : isRunning
                        ? `${scan} 1.4s ease-in-out ${(Math.floor(index / ROWS) % 24) * 60}ms infinite`
                        : "none",
                  }}
                />
              );
            })}
          </Box>
          {dayMarkers.map((marker) => (
            <Typography
              key={`${marker.column}-${marker.label}`}
              variant="caption"
              color="text.disabled"
              sx={{
                position: "absolute",
                bottom: 0,
                left: marker.column * (CELL + GAP),
                fontSize: 10,
                whiteSpace: "nowrap",
              }}
            >
              {marker.label}
            </Typography>
          ))}
        </Box>
      </Box>

      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        component="div"
        sx={{ minHeight: 18 }}
      >
        {hoveredTrace ? (
          <>
            <Box component="span" sx={{ fontWeight: 600, color: "text.primary" }}>
              {formatTime(hoveredTrace.time)} ·{" "}
              {hoveredAnswer === "error"
                ? "Couldn't evaluate"
                : hoveredAnswer ?? (isRunning ? "Waiting for Jev" : "Not answered")}
            </Box>
            {hoveredTrace.input ? ` · "${hoveredTrace.input.slice(0, 140)}"` : ""}
            {" · click to open the trace"}
          </>
        ) : traces.length ? (
          "Each square is one trace, oldest to newest. Hover to preview, click to open, and click an answer above to filter the grid."
        ) : (
          ""
        )}
      </Typography>
    </Box>
  );
}

InstantEvalMap.propTypes = {
  run: PropTypes.object.isRequired,
  onToggleAnswerFilter: PropTypes.func.isRequired,
  isAnswerFilterActive: PropTypes.func.isRequired,
  onOpenTrace: PropTypes.func.isRequired,
  onShowGraph: PropTypes.func.isRequired,
  onOpenPanel: PropTypes.func,
};
