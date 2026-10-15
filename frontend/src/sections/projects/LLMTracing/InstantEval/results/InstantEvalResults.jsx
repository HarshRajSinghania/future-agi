import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, keyframes, useTheme } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { ANSWER_TYPES, readOption } from "../instantEvalPayloads";
import { buildAnswerFilter, explainErrorGroups } from "../useInstantEval";
import {
  insightsSeedFromAnswers,
  answerText,
  filterRows,
  isSettled,
  isUnsure,
  labelCountsText,
  quoted,
  rowAnswered,
  summarizeQuestion,
  traceRecords,
  withPlaceholders,
} from "../instantEvalAnswers";
import {
  askedRows,
  filtersWindow,
  formatWhen,
  runStatusText,
  unitMeta,
} from "../instantEvalUnits";
import { computeAnswerStats } from "./answerStats";
import { answerColor, distributionEntries } from "./answerColors";
import AnswerBehaviour from "./AnswerBehaviour";
import AnswerHeatmap from "./AnswerHeatmap";
import KeepAnswering from "./KeepAnswering";
import { dayLabel, hourRange } from "./heatmap";

const PAGE = 50;

const pulse = keyframes`
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
`;

const percent = (share) => `${Math.round(share * 100)}%`;

// Ticks once a second while a run is working, for the elapsed clock.
function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * One question's answers as a bar and a legend. While Jev is reading, the bar
 * is measured against every row asked about, so it fills as answers land;
 * once done it is the split of the answered rows.
 */
function Distribution({
  item,
  summary,
  selected,
  onSelect,
  unit,
  expected,
  working,
}) {
  const theme = useTheme();
  const noun = unitMeta(unit);
  const entries = distributionEntries(summary);
  const denominator = working
    ? Math.max(summary.total + summary.pending, expected || 0, 1)
    : Math.max(summary.total, 1);
  const reading = working ? denominator - summary.total : 0;
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
                width: `${(entry.count / denominator) * 100}%`,
                bgcolor: answerColor(item, entry.answer, theme),
                opacity: selected && selected !== entry.answer ? 0.35 : 1,
                transition: "width 500ms ease, opacity 150ms",
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
                {entry.count.toLocaleString()} ·{" "}
                {summary.total ? percent(entry.share) : "–"}
              </Typography>
            </Stack>
          );
        })}
        {reading > 0 && (
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{ px: 1, py: 0.5 }}
          >
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: "2px",
                flexShrink: 0,
                bgcolor: alpha(theme.palette.text.disabled, 0.4),
                animation: `${pulse} 1.6s ease-in-out infinite`,
              }}
            />
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ flex: 1, minWidth: 0 }}
            >
              Still reading
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
            >
              {reading.toLocaleString()}
            </Typography>
          </Stack>
        )}
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
  expected: PropTypes.number,
  working: PropTypes.bool,
};

function ReadingLabel() {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      noWrap
      sx={{ animation: `${pulse} 1.6s ease-in-out infinite` }}
    >
      Reading…
    </Typography>
  );
}

function AnswerRow({ row, item, unit, working, onOpen }) {
  const theme = useTheme();
  const entry = row.answers?.[item.configId];
  const settled = isSettled(entry);
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
  const waiting = !settled && (working || entry?.pending);
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
            bgcolor: settled
              ? answerColor(item, entry.answer, theme)
              : "text.disabled",
            ...(waiting && {
              animation: `${pulse} 1.6s ease-in-out infinite`,
            }),
          }}
        />
        {settled ? (
          <Typography
            variant="caption"
            fontWeight={600}
            noWrap
            title={answerText(entry.answer)}
            sx={{ minWidth: 0 }}
          >
            {answerText(entry.answer)}
          </Typography>
        ) : waiting ? (
          <ReadingLabel />
        ) : (
          <Typography variant="caption" color="text.disabled" noWrap>
            No answer
          </Typography>
        )}
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
        {row.placeholder && !title ? (
          <Skeleton variant="text" width="70%" sx={{ fontSize: "0.875rem" }} />
        ) : (
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
        )}
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
  working: PropTypes.bool,
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
  const rows = useMemo(
    () => withPlaceholders(run.answers, run.placeholders),
    [run.answers, run.placeholders],
  );
  const isWorking = ["collecting", "creating", "running"].includes(run.phase);
  const isDone = run.phase === "done";
  const now = useNow(isWorking && !run.viewing);

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

  const answeredRows = rows.filter((row) => rowAnswered(row, items)).length;
  const expected = askedRows(run, unit);
  const statusText = runStatusText(run, unit, answeredRows, now);
  const progressValue =
    run.phase === "running" && expected
      ? Math.min(100, (answeredRows / expected) * 100)
      : null;
  const progress = run.progress;
  const selectedCount = selected
    ? summary?.labels.find((entry) => entry.label === selected)?.count || 0
    : 0;
  const isLabel = selected && item?.labels.includes(selected);
  const activeView = view === "behaviour" && !hasBehaviour ? "rows" : view;
  const readsLabel = item?.reads ? readOption(unit, item.reads).label : null;
  const canFilterGrid = onShowInGrid && (unit === "traces" || unit === "spans");

  return (
    <Stack spacing={2}>
      <Box>
        <Typography
          variant="body2"
          color="text.secondary"
          aria-live="polite"
          sx={{ mb: isWorking ? 1 : 0, fontVariantNumeric: "tabular-nums" }}
        >
          {statusText}
        </Typography>
        {isWorking && (
          <LinearProgress
            variant={progressValue != null ? "determinate" : "indeterminate"}
            value={progressValue ?? undefined}
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
                {readsLabel && ` · Jev read ${readsLabel.toLowerCase()}`}
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

          {summary.total > 0 || (isWorking && expected > 0) ? (
            <Distribution
              item={item}
              summary={summary}
              selected={selected}
              onSelect={(answer) => {
                setSelected(answer);
                setShown(PAGE);
              }}
              unit={unit}
              expected={expected}
              working={isWorking}
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
              {isDone &&
                isLabel &&
                selectedCount > 0 &&
                onInsights &&
                unit !== "spans" && (
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
              {isDone && isLabel && selectedCount > 0 && canFilterGrid && (
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

      {item && rows.length > 0 && unit === "traces" && isDone && (
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

      {item && activeView === "when" && unit === "traces" && isDone && (
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

      {item && activeView === "behaviour" && hasBehaviour && isDone && (
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

      {item && (activeView === "rows" || !isDone) && rows.length > 0 && (
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
                  working={isWorking}
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
              {run.viewing ? "Ask again on this view" : "Run again"}
            </Button>
          )}
          {(unit === "traces" || unit === "spans") &&
            rows.length > 0 &&
            !run.viewing &&
            !run.handedOver && (
              <KeepAnswering
                projectId={projectId}
                run={run}
                navigate={navigate}
                unit={unit}
              />
            )}
        </Stack>
      )}
    </Stack>
  );
}

InstantEvalResults.propTypes = {
  projectId: PropTypes.string.isRequired,
  unit: PropTypes.oneOf(["traces", "spans", "sessions", "users"]).isRequired,
  run: PropTypes.object.isRequired,
  navigate: PropTypes.func.isRequired,
  onOpenRow: PropTypes.func,
  onShowInGrid: PropTypes.func,
  onInsights: PropTypes.func,
  onRunAgain: PropTypes.func,
};
