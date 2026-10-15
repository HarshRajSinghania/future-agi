import React, { useEffect, useMemo, useRef } from "react";
import PropTypes from "prop-types";
import {
  Box,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, keyframes, useTheme } from "@mui/material/styles";
import { ERROR_ANSWER } from "../useInstantEval";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const HOUR_TICKS = new Set([0, 3, 6, 9, 12, 15, 18, 21]);
const MAX_DAY_ROWS = 31;
const LEVELS = 5;

const changed = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(120, 87, 252, 0.55); }
  100% { box-shadow: 0 0 0 5px rgba(120, 87, 252, 0); }
`;

const dayKey = (date) =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

const hourLabel = (hour) => {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? "a" : "p"}`;
};

const hourRange = (hour) =>
  `${hourLabel(hour).replace("a", " AM").replace("p", " PM")}–${hourLabel(
    (hour + 1) % 24,
  )
    .replace("a", " AM")
    .replace("p", " PM")}`;

const dayLabel = (date) =>
  date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

// Rows are calendar days in the viewer's timezone. The scope window decides
// the rows when it is short enough to show every day (empty days included, so
// a quiet day reads as quiet rather than disappearing); otherwise only days
// that have traces are shown.
export function buildHeatmap({ traces, configId, label, window }) {
  const start = window?.[0] ? new Date(window[0]) : null;
  const end = window?.[1] ? new Date(window[1]) : null;
  const days = [];
  if (start && end && !Number.isNaN(start) && !Number.isNaN(end)) {
    const cursor = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
    );
    while (cursor <= end && days.length <= MAX_DAY_ROWS) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  const useWindow = days.length > 0 && days.length <= MAX_DAY_ROWS;
  const cells = new Map();
  const seenDays = new Map();
  traces.forEach((trace) => {
    const time = new Date(trace.time);
    if (Number.isNaN(time.getTime())) return;
    const key = `${dayKey(time)}|${time.getHours()}`;
    const cell = cells.get(key) || {
      total: 0,
      matches: 0,
      answered: 0,
      traceIds: [],
      first: time.getTime(),
      last: time.getTime(),
    };
    const answer = trace.answers?.[configId];
    cell.total += 1;
    cell.first = Math.min(cell.first, time.getTime());
    cell.last = Math.max(cell.last, time.getTime());
    if (answer !== undefined && answer !== ERROR_ANSWER) cell.answered += 1;
    if (answer === label) {
      cell.matches += 1;
      cell.traceIds.push(trace.traceId);
    }
    cells.set(key, cell);
    if (!seenDays.has(dayKey(time)))
      seenDays.set(
        dayKey(time),
        new Date(time.getFullYear(), time.getMonth(), time.getDate()),
      );
  });
  const rows = (useWindow ? days : [...seenDays.values()].sort((a, b) => a - b))
    .slice(-MAX_DAY_ROWS)
    .map((date) => ({
      date,
      cells: HOURS.map((hour) => cells.get(`${dayKey(date)}|${hour}`) || null),
    }));
  return rows;
}

const cellValue = (cell, mode) => {
  if (!cell) return 0;
  if (mode === "rate") return cell.answered ? cell.matches / cell.answered : 0;
  return cell.matches;
};

function levelFor(value, max) {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(1, Math.ceil((value / max) * (LEVELS - 1)));
}

export default function AnswerHeatmap({
  traces,
  configId,
  label,
  window,
  mode,
  onModeChange,
  onSelectCell,
  isRunning,
  color,
}) {
  const theme = useTheme();
  const previous = useRef(new Map());
  const rows = useMemo(
    () => buildHeatmap({ traces, configId, label, window }),
    [traces, configId, label, window],
  );
  const max = useMemo(
    () =>
      rows.reduce(
        (top, row) =>
          Math.max(top, ...row.cells.map((cell) => cellValue(cell, mode))),
        0,
      ),
    [rows, mode],
  );

  const accent = color || theme.palette.primary.main;
  const levelColor = (level) =>
    level === 0
      ? alpha(theme.palette.text.disabled, 0.14)
      : alpha(accent, 0.18 + (level / (LEVELS - 1)) * 0.82);

  const changedKeys = new Set();
  rows.forEach((row) =>
    row.cells.forEach((cell, hour) => {
      const key = `${dayKey(row.date)}|${hour}`;
      const before = previous.current.get(key);
      if (cell && before !== undefined && before !== cell.matches)
        changedKeys.add(key);
    }),
  );
  // Remember the counts on screen so the next poll can highlight what moved.
  useEffect(() => {
    previous.current = new Map(
      rows.flatMap((row) =>
        row.cells.map((cell, hour) => [
          `${dayKey(row.date)}|${hour}`,
          cell?.matches ?? 0,
        ]),
      ),
    );
  }, [rows]);

  if (!rows.length) return null;

  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1 }}
      >
        <Typography variant="caption" color="text.secondary">
          When traces answered{" "}
          <Box component="span" sx={{ fontWeight: 600, color: "text.primary" }}>
            {label}
          </Box>{" "}
          happened, by day and hour (your local time)
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          onChange={(_, value) => value && onModeChange(value)}
          aria-label="Heatmap measure"
        >
          <ToggleButton
            value="count"
            sx={{ py: 0.25, px: 1, textTransform: "none" }}
          >
            Count
          </ToggleButton>
          <ToggleButton
            value="rate"
            sx={{ py: 0.25, px: 1, textTransform: "none" }}
          >
            Rate
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <Box
        role="grid"
        aria-label={`Traces answered ${label} by day and hour`}
        sx={{
          display: "grid",
          gridTemplateColumns: "72px repeat(24, minmax(10px, 1fr)) 44px",
          columnGap: "3px",
          rowGap: "3px",
          alignItems: "center",
        }}
      >
        <Box />
        {HOURS.map((hour) => (
          <Typography
            key={hour}
            variant="caption"
            color="text.disabled"
            sx={{ fontSize: 10, textAlign: "left", whiteSpace: "nowrap" }}
          >
            {HOUR_TICKS.has(hour) ? hourLabel(hour) : ""}
          </Typography>
        ))}
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ fontSize: 10, textAlign: "right" }}
        >
          {mode === "rate" ? "rate" : label}
        </Typography>

        {rows.map((row) => {
          const rowMatches = row.cells.reduce(
            (sum, cell) => sum + (cell?.matches || 0),
            0,
          );
          const rowAnswered = row.cells.reduce(
            (sum, cell) => sum + (cell?.answered || 0),
            0,
          );
          return (
            <React.Fragment key={dayKey(row.date)}>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ fontSize: 11 }}
              >
                {dayLabel(row.date)}
              </Typography>
              {row.cells.map((cell, hour) => {
                const key = `${dayKey(row.date)}|${hour}`;
                const value = cellValue(cell, mode);
                const level = levelFor(value, max);
                // A share needs answered traces; without them the rate is
                // unknown, not 0%.
                const empty = !cell || (mode === "rate" && !cell.answered);
                const tooltip = !cell
                  ? `${dayLabel(row.date)} · ${hourRange(hour)} — no traces`
                  : empty
                    ? `${dayLabel(row.date)} · ${hourRange(hour)} — ${cell.total} trace${cell.total === 1 ? "" : "s"}, none answered yet`
                    : `${dayLabel(row.date)} · ${hourRange(hour)} — ${cell.matches} of ${cell.answered} answered trace${cell.answered === 1 ? "" : "s"} said ${label}${
                        cell.answered
                          ? ` (${Math.round((cell.matches / cell.answered) * 100)}%)`
                          : ""
                      }${isRunning && cell.answered < cell.total ? " · still answering" : ""}${
                        cell.matches ? " · click to see them" : ""
                      }`;
                return (
                  <Tooltip
                    key={key}
                    title={tooltip}
                    placement="top"
                    disableInteractive
                  >
                    <Box
                      role="gridcell"
                      aria-label={tooltip}
                      tabIndex={cell?.matches ? 0 : -1}
                      onClick={() =>
                        cell?.matches && onSelectCell(row.date, hour, cell)
                      }
                      onKeyDown={(event) => {
                        if (
                          cell?.matches &&
                          (event.key === "Enter" || event.key === " ")
                        ) {
                          event.preventDefault();
                          onSelectCell(row.date, hour, cell);
                        }
                      }}
                      sx={{
                        height: 18,
                        borderRadius: "3px",
                        bgcolor: empty ? "transparent" : levelColor(level),
                        border: empty ? "1px dashed" : "none",
                        borderColor: alpha(theme.palette.text.disabled, 0.25),
                        cursor: cell?.matches ? "pointer" : "default",
                        transition: "background-color 450ms ease",
                        animation: changedKeys.has(key)
                          ? `${changed} 900ms ease-out`
                          : "none",
                        "&:hover": cell?.matches
                          ? {
                              outline: `2px solid ${theme.palette.text.primary}`,
                              outlineOffset: 1,
                            }
                          : undefined,
                        "&:focus-visible": {
                          outline: `2px solid ${theme.palette.primary.main}`,
                          outlineOffset: 1,
                        },
                      }}
                    />
                  </Tooltip>
                );
              })}
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontSize: 11, textAlign: "right" }}
              >
                {mode === "rate"
                  ? rowAnswered
                    ? `${Math.round((rowMatches / rowAnswered) * 100)}%`
                    : "–"
                  : rowMatches}
              </Typography>
            </React.Fragment>
          );
        })}
      </Box>

      <Stack
        direction="row"
        alignItems="center"
        spacing={0.75}
        sx={{ mt: 1.25 }}
      >
        <Typography variant="caption" color="text.disabled">
          {mode === "rate" ? "Lower" : "Fewer"}
        </Typography>
        {Array.from({ length: LEVELS }, (_, level) => (
          <Box
            key={level}
            sx={{
              width: 12,
              height: 12,
              borderRadius: "2px",
              bgcolor: levelColor(level),
            }}
          />
        ))}
        <Typography variant="caption" color="text.disabled">
          {mode === "rate" ? "Higher share" : "More"}
        </Typography>
        <Box
          sx={{
            width: 12,
            height: 12,
            ml: 1.5,
            borderRadius: "2px",
            border: "1px dashed",
            borderColor: alpha(theme.palette.text.disabled, 0.35),
          }}
        />
        <Typography variant="caption" color="text.disabled">
          No traces
        </Typography>
      </Stack>
    </Box>
  );
}

AnswerHeatmap.propTypes = {
  traces: PropTypes.array.isRequired,
  configId: PropTypes.string,
  label: PropTypes.string.isRequired,
  window: PropTypes.array,
  mode: PropTypes.oneOf(["count", "rate"]).isRequired,
  onModeChange: PropTypes.func.isRequired,
  onSelectCell: PropTypes.func.isRequired,
  isRunning: PropTypes.bool,
  color: PropTypes.string,
};
