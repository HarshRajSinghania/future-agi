import React, { useMemo } from "react";
import PropTypes from "prop-types";
import {
  Box,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import { computeAnswerStats } from "./answerStats";

const formatLatency = (ms) => {
  if (ms == null) return "–";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
};

const formatPercent = (value) =>
  value == null ? "–" : `${Math.round(value * 1000) / 10}%`;

const formatCost = (value) =>
  value == null
    ? "–"
    : value < 0.01
      ? `$${value.toFixed(4)}`
      : `$${value.toFixed(2)}`;

function Callout({ label, tone, title }) {
  return (
    <Tooltip title={title}>
      <Chip
        size="small"
        label={label}
        color={tone}
        variant="outlined"
        sx={{ ml: 1, height: 20, fontSize: 11 }}
      />
    </Tooltip>
  );
}

Callout.propTypes = {
  label: PropTypes.string.isRequired,
  tone: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
};

export default function AnswerBehaviour({ traces, item, selected, onSelect }) {
  const stats = useMemo(() => computeAnswerStats(traces, item), [traces, item]);
  const rows = stats.rows.filter((row) => row.count > 0);
  if (rows.length < 2 || (!stats.hasLatency && !stats.hasCost)) return null;
  const notable = rows.some((row) => row.latencyNotable || row.errorNotable);

  return (
    <Box>
      <Typography variant="subtitle2">How each answer behaves</Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        component="p"
        sx={{ mb: 1 }}
      >
        Compared with every other answered trace in this run.{" "}
        {notable
          ? "Highlighted differences are unlikely to be chance (Benjamini-Hochberg, 5%)."
          : "No difference here is large enough to rule out chance."}
      </Typography>
      <Table size="small" sx={{ "& td, & th": { py: 0.75 } }}>
        <TableHead>
          <TableRow>
            <TableCell>Answer</TableCell>
            <TableCell align="right">Traces</TableCell>
            {stats.hasLatency && (
              <TableCell align="right">Median latency</TableCell>
            )}
            {stats.hasErrors && <TableCell align="right">Error rate</TableCell>}
            {stats.hasCost && <TableCell align="right">Avg cost</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.label}
              hover
              selected={row.label === selected}
              onClick={() => onSelect(row.label)}
              sx={{ cursor: "pointer" }}
            >
              <TableCell sx={{ fontWeight: 600 }}>{row.label}</TableCell>
              <TableCell align="right">
                {row.count} · {formatPercent(row.share)}
              </TableCell>
              {stats.hasLatency && (
                <TableCell align="right">
                  {formatLatency(row.latency)}
                  {row.latencyNotable && (
                    <Callout
                      label={
                        row.latencyRatio >= 1
                          ? `${row.latencyRatio.toFixed(1)}× slower`
                          : `${(1 / row.latencyRatio).toFixed(1)}× faster`
                      }
                      tone={row.latencyRatio >= 1 ? "warning" : "success"}
                      title={`Median ${formatLatency(row.latency)} vs ${formatLatency(row.restLatency)} for every other answer`}
                    />
                  )}
                </TableCell>
              )}
              {stats.hasErrors && (
                <TableCell align="right">
                  {formatPercent(row.errorRate)}
                  {row.errorNotable && (
                    <Callout
                      label={
                        row.errorRate > row.restErrorRate ? "higher" : "lower"
                      }
                      tone={
                        row.errorRate > row.restErrorRate ? "error" : "success"
                      }
                      title={`${formatPercent(row.errorRate)} vs ${formatPercent(row.restErrorRate)} for every other answer`}
                    />
                  )}
                </TableCell>
              )}
              {stats.hasCost && (
                <TableCell align="right">{formatCost(row.cost)}</TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

AnswerBehaviour.propTypes = {
  traces: PropTypes.array.isRequired,
  item: PropTypes.object.isRequired,
  selected: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
};
