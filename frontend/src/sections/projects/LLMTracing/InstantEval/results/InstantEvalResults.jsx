import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { ANSWER_TYPES } from "../instantEvalPayloads";
import { buildAnswerFilter, explainErrorGroups } from "../useInstantEval";
import {
  ERROR_ANSWER,
  SKIPPED_ANSWER,
  insightsSeedFromAnswers,
  answerText,
  filterRows,
  isUnsure,
  labelCountsText,
  quoted,
  summarizeQuestion,
  traceRecords,
} from "../instantEvalAnswers";
import {
  filtersWindow,
  formatWhen,
  runStatusText,
  unitMeta,
} from "../instantEvalUnits";
import { computeAnswerStats } from "./answerStats";
import AnswerBehaviour from "./AnswerBehaviour";
import AnswerHeatmap from "./AnswerHeatmap";
import KeepAnswering from "./KeepAnswering";
import { dayLabel, hourRange } from "./heatmap";

const PAGE = 50;

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

function answerColor(item, answer, theme) {
  if (answer === ERROR_ANSWER) return alpha(theme.palette.error.main, 0.45);
  if (answer === SKIPPED_ANSWER) return theme.palette.grey[400];
  if (item.answerType === ANSWER_TYPES.CATEGORY) {
    const index = item.labels.indexOf(answer);
    return CATEGORY_COLORS[
      (index >= 0 ? index : item.labels.length) % CATEGORY_COLORS.length
    ];
  }
  return answer === "Yes"
    ? theme.palette.primary.main
    : theme.palette.grey[500];
}

const percent = (share) => `${Math.round(share * 100)}%`;

function Distribution({ item, summary, selected, onSelect, unit }) {
  const theme = useTheme();
  const noun = unitMeta(unit);
  const entries = [
    ...summary.labels.map((entry) => ({ ...entry, answer: entry.label })),
    ...(summary.errors.count
      ? [{ ...summary.errors, answer: ERROR_ANSWER, muted: true }]
      : []),
    ...(summary.skipped.count
      ? [{ ...summary.skipped, answer: SKIPPED_ANSWER, muted: true }]
      : []),
  ];
  return (
    <Box>
      <Box
        aria-hidden
        sx={{
          display: "flex",
          height: 10,
          borderRadius: 1,
          overflow: "hidden",
          bgcolor: alpha(theme.palette.text.disabled, 0.12),
          mb: 1.25,
        }}
      >
        {entries
          .filter((entry) => entry.count > 0)
          .map((entry) => (
            <Box
              key={entry.answer}
              sx={{
                width: `${entry.share * 100}%`,
                bgcolor: answerColor(item, entry.answer, theme),
                opacity: selected && selected !== entry.answer ? 0.35 : 1,
                transition: "width 400ms ease, opacity 150ms",
              }}
            />
          ))}
      </Box>
      <Stack spacing={0.25}>
        {entries.map((entry) => {
          const active = selected === entry.answer;
          const label = answerText(entry.answer);
          return (
            <Stack
              key={entry.answer}
              direction="row"
              alignItems="center"
              spacing={1}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              aria-label={`${label}: ${entry.count} ${noun.plural}, ${percent(entry.share)}`}
              onClick={() => onSelect(active ? null : entry.answer)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(active ? null : entry.answer);
                }
              }}
              sx={{
                px: 1,
                py: 0.5,
                borderRadius: 0.75,
                cursor: "pointer",
                bgcolor: active ? "action.selected" : "transparent",
                "&:hover": {
                  bgcolor: active ? "action.selected" : "action.hover",
                },
              }}
            >
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "2px",
                  flexShrink: 0,
                  bgcolor: answerColor(item, entry.answer, theme),
                }}
              />
              <Typography
                variant="body2"
                fontWeight={entry.muted ? 400 : 600}
                color={entry.muted ? "text.secondary" : "text.primary"}
                noWrap
                sx={{ flex: 1, minWidth: 0 }}
              >
                {label}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
              >
                {entry.count.toLocaleString()} · {percent(entry.share)}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}

Distribution.propTypes = {
  item: PropTypes.object.isRequired,
  summary: PropTypes.object.isRequired,
  selected: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
  unit: PropTypes.string.isRequired,
};

function AnswerRow({ row, item, unit, onOpen }) {
  const theme = useTheme();
  const entry = row.answers?.[item.configId];
  const unsure = isUnsure(entry);
  const isUser = unit === "users";
  const title = isUser ? row.userId || row.label : row.excerpt || row.label;
  const meta = [
    !isUser && row.userId,
    row.time && formatWhen(row.time),
    isUser &&
      row.sessions != null &&
      `${row.sessions} session${row.sessions === 1 ? "" : "s"}`,
    isUser && entry?.counts && labelCountsText(entry.counts),
  ].filter(Boolean);
  const open = () => onOpen?.(row);
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter") open();
      }}
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 1.25,
        px: 1.25,
        py: 1,
        borderBottom: "1px solid",
        borderColor: "divider",
        cursor: onOpen ? "pointer" : "default",
        "&:hover": { bgcolor: "action.hover" },
        "&:last-of-type": { borderBottom: "none" },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.5}
        sx={{ width: 112, flexShrink: 0, pt: 0.25 }}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            flexShrink: 0,
            bgcolor: entry
              ? answerColor(item, entry.answer, theme)
              : "text.disabled",
          }}
        />
        <Typography
          variant="caption"
          fontWeight={600}
          noWrap
          title={entry ? answerText(entry.answer) : "Not answered yet"}
          color={entry ? "text.primary" : "text.disabled"}
          sx={{ minWidth: 0 }}
        >
          {entry ? answerText(entry.answer) : "Pending"}
        </Typography>
        {unsure && (
          <Tooltip
            title={`Jev was unsure (${percent(entry.confidence)} confident)`}
          >
            <Box
              component="span"
              sx={{ display: "inline-flex", color: "warning.main" }}
            >
              <Iconify
                icon="mdi:help-circle-outline"
                width={14}
                aria-label="Jev was unsure"
              />
            </Box>
          </Tooltip>
        )}
      </Stack>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="body2"
          fontWeight={isUser ? 600 : 400}
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "break-word",
          }}
        >
          {title || "(no input)"}
        </Typography>
        {isUser && row.excerpt && (
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            component="p"
          >
            Latest: {row.excerpt}
          </Typography>
        )}
        {meta.length > 0 && (
          <Typography
            variant="caption"
            color="text.disabled"
            noWrap
            component="p"
          >
            {meta.join(" · ")}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

AnswerRow.propTypes = {
  row: PropTypes.object.isRequired,
  item: PropTypes.object.isRequired,
  unit: PropTypes.string.isRequired,
  onOpen: PropTypes.func,
};

// The answer worth looking at first in the heatmap: "Yes" for yes/no
// questions, otherwise the most common category.
const heatmapLabel = (item, summary, selected) => {
  if (selected && item.labels.includes(selected)) return selected;
  if (item.answerType !== ANSWER_TYPES.CATEGORY) return "Yes";
  const top = [...summary.labels].sort((a, b) => b.count - a.count)[0];
  return top?.label || item.labels[0];
};

export default function InstantEvalResults({
  projectId,
  unit,
  run,
  navigate,
  onOpenRow,
  onShowInGrid,
  onInsights,
  onRunAgain,
}) {
  const theme = useTheme();
  const meta = unitMeta(unit);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [unsureOnly, setUnsureOnly] = useState(false);
  const [cell, setCell] = useState(null);
  const [view, setView] = useState("rows");
  const [heatmapMode, setHeatmapMode] = useState("count");
  const [shown, setShown] = useState(PAGE);

  const items = useMemo(() => run.items || [], [run.items]);
  const item = items[Math.min(questionIndex, Math.max(0, items.length - 1))];
  const rows = useMemo(() => run.answers?.rows || [], [run.answers]);
  const isWorking = ["collecting", "creating", "running"].includes(run.phase);
  const isDone = run.phase === "done";

  useEffect(() => {
    setQuestionIndex(0);
  }, [run.taskId]);
  useEffect(() => {
    setSelected(null);
    setUnsureOnly(false);
    setCell(null);
    setShown(PAGE);
  }, [run.taskId, questionIndex]);

  const summary = useMemo(
    () => (item ? summarizeQuestion(rows, item) : null),
    [rows, item],
  );
  const visible = useMemo(
    () =>
      item
        ? filterRows(rows, {
            configId: item.configId,
            answer: selected,
            unsureOnly,
            ids: cell?.ids,
          })
        : [],
    [rows, item, selected, unsureOnly, cell],
  );
  const records = useMemo(
    () => (unit === "traces" ? traceRecords(rows, items, run.metrics) : []),
    [unit, rows, items, run.metrics],
  );
  const hasBehaviour = useMemo(() => {
    if (unit !== "traces" || !run.metrics || !item) return false;
    const stats = computeAnswerStats(records, item);
    return (
      stats.rows.filter((row) => row.count > 0).length >= 2 &&
      (stats.hasLatency || stats.hasCost)
    );
  }, [unit, run.metrics, records, item]);

  const answeredRows = rows.filter((row) =>
    items.every((entry) => row.answers[entry.configId]),
  ).length;
  const statusText = runStatusText(run, unit, answeredRows);
  const progress = run.progress;
  const processed = progress
    ? Math.min(
        (progress.completed || 0) + (progress.failed || 0),
        progress.total,
      )
    : 0;
  const selectedCount = selected
    ? summary?.labels.find((entry) => entry.label === selected)?.count || 0
    : 0;
  const isLabel = selected && item?.labels.includes(selected);
  const activeView = view === "behaviour" && !hasBehaviour ? "rows" : view;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: isWorking ? 1 : 0 }}
        >
          {statusText}
        </Typography>
        {isWorking && (
          <LinearProgress
            variant={progress?.total ? "determinate" : "indeterminate"}
            value={
              progress?.total
                ? Math.min(100, (processed / progress.total) * 100)
                : undefined
            }
            sx={{ height: 4, borderRadius: 2 }}
          />
        )}
      </Box>

      {run.error && <Alert severity="warning">{run.error}</Alert>}
      {isDone && progress?.failed > 0 && (
        <Alert severity="warning">
          {explainErrorGroups(progress.errorGroups).map((entry, index) => (
            <Box key={index} component="span" sx={{ display: "block" }}>
              {entry.count} answer{entry.count === 1 ? "" : "s"} {entry.reason}
              {entry.settingsPath && (
                <Button
                  size="small"
                  onClick={() => navigate(entry.settingsPath)}
                  sx={{ ml: 1, textTransform: "none", py: 0 }}
                >
                  Open AI Providers
                </Button>
              )}
            </Box>
          ))}
          {!progress.errorGroups?.length &&
            `${progress.failed} ${unit === "users" ? "sessions" : meta.plural} couldn't be evaluated.`}
        </Alert>
      )}

      {items.length > 1 && (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {items.map((entry, index) => (
            <Chip
              key={entry.configId || index}
              size="small"
              label={`${index + 1}. ${entry.question}`}
              title={entry.question}
              color={index === questionIndex ? "primary" : "default"}
              variant={index === questionIndex ? "filled" : "outlined"}
              onClick={() => setQuestionIndex(index)}
              sx={{ maxWidth: 280 }}
            />
          ))}
        </Stack>
      )}

      {item && summary && !run.empty && (
        <Box
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            p: 2,
          }}
        >
          <Stack
            direction="row"
            alignItems="flex-start"
            justifyContent="space-between"
            spacing={1.5}
            sx={{ mb: 1.5 }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="overline" color="text.secondary">
                {item.answerType === ANSWER_TYPES.CATEGORY
                  ? "Categories"
                  : "Yes / No"}
              </Typography>
              <Typography variant="subtitle1" sx={{ lineHeight: 1.35 }}>
                {item.question}
              </Typography>
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

          {summary.total > 0 ? (
            <Distribution
              item={item}
              summary={summary}
              selected={selected}
              onSelect={(answer) => {
                setSelected(answer);
                setShown(PAGE);
              }}
              unit={unit}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {isWorking
                ? `Answers appear here as Jev finishes each ${unit === "users" ? "session" : meta.noun}.`
                : "No answers came back for this question."}
            </Typography>
          )}

          {isLabel && item.definitions?.[selected] && (
            <Typography
              variant="caption"
              color="text.secondary"
              component="p"
              sx={{ px: 1, mt: 1 }}
            >
              <Box component="span" sx={{ fontWeight: 600 }}>
                {selected}:
              </Box>{" "}
              {item.definitions[selected]}
            </Typography>
          )}

          {(summary.unsure > 0 || (isDone && isLabel && selectedCount > 0)) && (
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              flexWrap="wrap"
              useFlexGap
              sx={{ mt: 1.5 }}
            >
              {summary.unsure > 0 && (
                <Tooltip
                  describeChild
                  title="Answers Jev gave with less than 60% confidence"
                >
                  <Chip
                    size="small"
                    icon={<Iconify icon="mdi:help-circle-outline" width={16} />}
                    label={`Jev was unsure on ${summary.unsure}`}
                    color={unsureOnly ? "warning" : "default"}
                    variant={unsureOnly ? "filled" : "outlined"}
                    onClick={() => setUnsureOnly((value) => !value)}
                    aria-pressed={unsureOnly}
                  />
                </Tooltip>
              )}
              {isDone && isLabel && selectedCount > 0 && onInsights && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={
                    <Iconify icon="mdi:chart-box-outline" width={16} />
                  }
                  onClick={() =>
                    onInsights(
                      insightsSeedFromAnswers({
                        unit,
                        item,
                        answer: selected,
                        rows,
                      }),
                    )
                  }
                  sx={{ textTransform: "none" }}
                >
                  Find patterns in these {selectedCount} {quoted(selected)}{" "}
                  {selectedCount === 1 ? meta.noun : meta.plural}
                </Button>
              )}
              {isDone && isLabel && selectedCount > 0 && onShowInGrid && (
                <Button
                  size="small"
                  startIcon={<Iconify icon="mdi:filter-outline" width={16} />}
                  onClick={() =>
                    onShowInGrid(buildAnswerFilter(item, [selected]))
                  }
                  sx={{ textTransform: "none" }}
                >
                  Show in grid
                </Button>
              )}
            </Stack>
          )}
        </Box>
      )}

      {item && rows.length > 0 && unit === "traces" && (
        <ToggleButtonGroup
          exclusive
          size="small"
          value={activeView}
          onChange={(_, next) => next && setView(next)}
          aria-label="Results view"
          sx={{ alignSelf: "flex-start" }}
        >
          <ToggleButton value="rows" sx={{ textTransform: "none", px: 1.5 }}>
            Traces
          </ToggleButton>
          <ToggleButton value="when" sx={{ textTransform: "none", px: 1.5 }}>
            By hour
          </ToggleButton>
          {hasBehaviour && (
            <ToggleButton
              value="behaviour"
              sx={{ textTransform: "none", px: 1.5 }}
            >
              Behaviour
            </ToggleButton>
          )}
        </ToggleButtonGroup>
      )}

      {item && activeView === "when" && unit === "traces" && (
        <AnswerHeatmap
          traces={records}
          configId={item.configId}
          label={heatmapLabel(item, summary, selected)}
          window={filtersWindow(run.scopeFilters)}
          mode={heatmapMode}
          onModeChange={setHeatmapMode}
          isRunning={isWorking}
          color={answerColor(
            item,
            heatmapLabel(item, summary, selected),
            theme,
          )}
          onSelectCell={(date, hour, hourCell) => {
            const answer = heatmapLabel(item, summary, selected);
            setSelected(answer);
            setCell({
              ids: new Set(hourCell?.traceIds || []),
              label: `${dayLabel(date)} · ${hourRange(hour)}`,
            });
            setView("rows");
          }}
        />
      )}

      {item && activeView === "behaviour" && hasBehaviour && (
        <AnswerBehaviour
          traces={records}
          item={item}
          selected={selected}
          onSelect={(answer) => {
            setSelected(answer);
            setView("rows");
          }}
        />
      )}

      {item && activeView === "rows" && rows.length > 0 && (
        <Box>
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.75}
            flexWrap="wrap"
            useFlexGap
            sx={{ mb: 1 }}
          >
            <Typography variant="subtitle2" sx={{ mr: 0.5 }}>
              {visible.length.toLocaleString()}{" "}
              {visible.length === 1 ? meta.noun : meta.plural}
            </Typography>
            {selected && (
              <Chip
                size="small"
                label={`Answer: ${answerText(selected)}`}
                onDelete={() => setSelected(null)}
              />
            )}
            {unsureOnly && (
              <Chip
                size="small"
                label="Jev was unsure"
                onDelete={() => setUnsureOnly(false)}
              />
            )}
            {cell && (
              <Chip
                size="small"
                label={cell.label}
                onDelete={() => setCell(null)}
              />
            )}
          </Stack>
          {visible.length ? (
            <Box
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
              }}
            >
              {visible.slice(0, shown).map((row) => (
                <AnswerRow
                  key={row.id}
                  row={row}
                  item={item}
                  unit={unit}
                  onOpen={onOpenRow}
                />
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No {meta.plural} match these filters.
            </Typography>
          )}
          {visible.length > shown && (
            <Button
              size="small"
              onClick={() => setShown((count) => count + PAGE)}
              sx={{ mt: 1, textTransform: "none" }}
            >
              Show {Math.min(PAGE, visible.length - shown)} more
            </Button>
          )}
        </Box>
      )}

      {isDone && (
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
          alignItems="flex-start"
        >
          {onRunAgain && items.every((entry) => entry.configId) && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<Iconify icon="mdi:refresh" width={16} />}
              onClick={onRunAgain}
              sx={{ textTransform: "none" }}
            >
              Run again
            </Button>
          )}
          {unit === "traces" && rows.length > 0 && !run.viewing && (
            <KeepAnswering
              projectId={projectId}
              run={run}
              navigate={navigate}
            />
          )}
        </Stack>
      )}
    </Stack>
  );
}

InstantEvalResults.propTypes = {
  projectId: PropTypes.string.isRequired,
  unit: PropTypes.oneOf(["traces", "sessions", "users"]).isRequired,
  run: PropTypes.object.isRequired,
  navigate: PropTypes.func.isRequired,
  onOpenRow: PropTypes.func,
  onShowInGrid: PropTypes.func,
  onInsights: PropTypes.func,
  onRunAgain: PropTypes.func,
};
