import React from "react";
import PropTypes from "prop-types";
import { Box, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { UNITS } from "src/sections/projects/observePopulation";
import {
  formatCount,
  formatLatency,
  formatPercent,
  formatSentiment,
} from "./analyseFormat";
import { Stat } from "./parts";

/** The tiles of the stat strip, in order, for a completed run. */
function buildTiles(run, lens) {
  const result = run.result || {};
  const totals = result.totals || {};
  const unit = UNITS[run.unit] || UNITS.traces;
  const analysed = totals.count ?? run.analysed_count ?? 0;
  const sample = result.sample_size ?? run.sample_size ?? 0;
  const population = result.population_size ?? run.population_size ?? 0;
  const excluded = result.excluded || 0;
  const tiles = [
    {
      key: "analysed",
      label: `${unit.title} analysed`,
      value: formatCount(analysed),
      hint:
        population > sample
          ? `of ${formatCount(sample)} sampled from ${formatCount(population)}`
          : `of ${formatCount(sample)} read`,
      help: "Items placed in a category. Sampled items that were left out, failed or had nothing to read are counted below.",
    },
  ];
  if (lens === "failures" && analysed + excluded > 0) {
    tiles.push({
      key: "prevalence",
      label: "Had a failure",
      value: formatPercent(analysed / (analysed + excluded)),
      hint: `${formatCount(analysed)} of ${formatCount(analysed + excluded)} read`,
      help: "Share of the items read in which the agent made a mistake. Only these are grouped below.",
    });
  }
  if (run.unit !== "users" && Number.isFinite(totals.users))
    tiles.push({
      key: "users",
      label: "Users",
      value: formatCount(totals.users),
      hint: "distinct users",
    });
  if (run.unit === "traces" && totals.sessions > 0)
    tiles.push({
      key: "sessions",
      label: "Sessions",
      value: formatCount(totals.sessions),
      hint: "distinct sessions",
    });
  if (lens !== "failures" && Number.isFinite(totals.failure_rate))
    tiles.push({
      key: "failure",
      label: "Agent failure",
      value: formatPercent(totals.failure_rate),
      hint: "had a mistake",
    });
  if (Number.isFinite(totals.unresolved_rate))
    tiles.push({
      key: "unresolved",
      label: "Unresolved",
      value: formatPercent(totals.unresolved_rate),
      hint: "unresolved or abandoned",
    });
  if (Number.isFinite(totals.sentiment))
    tiles.push({
      key: "sentiment",
      label: "Sentiment",
      value: formatSentiment(totals.sentiment),
      hint: "average, 1 to 5",
    });
  if (Number.isFinite(totals.error_rate))
    tiles.push({
      key: "errors",
      label: "Errors",
      value: formatPercent(totals.error_rate),
      hint: "hit an error",
    });
  if (Number.isFinite(totals.latency_ms))
    tiles.push({
      key: "latency",
      label: "Latency",
      value: formatLatency(totals.latency_ms),
      hint: "median",
    });
  return tiles;
}

export default function StatStrip({ run, lens }) {
  const result = run.result || {};
  const tiles = buildTiles(run, lens);
  const excluded = result.excluded || 0;
  const failed = result.failed || 0;
  const skipped = result.skipped || 0;
  const notes = [
    excluded > 0 &&
      `${formatCount(excluded)} left out (${lens === "failures" ? "no agent failure found" : "not relevant to the question"})`,
    failed > 0 && `${formatCount(failed)} could not be read by the model`,
    skipped > 0 && `${formatCount(skipped)} had nothing to read`,
  ].filter(Boolean);

  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5 }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))",
          "& > *": {
            px: 2,
            py: 1.5,
            borderRight: "1px solid",
            borderColor: "divider",
          },
          "& > *:last-of-type": { borderRight: 0 },
        }}
      >
        {tiles.map((tile) => (
          <Tooltip
            describeChild
            key={tile.key}
            arrow
            title={tile.help || ""}
            placement="top"
          >
            <Box>
              <Stat label={tile.label} value={tile.value} hint={tile.hint} />
            </Box>
          </Tooltip>
        ))}
      </Box>
      {notes.length > 0 && (
        <Stack
          sx={{ px: 2, py: 1, borderTop: "1px solid", borderColor: "divider" }}
        >
          <Typography variant="caption" color="text.secondary">
            Of the sample: {notes.join(" · ")}.
          </Typography>
        </Stack>
      )}
    </Paper>
  );
}

StatStrip.propTypes = {
  run: PropTypes.object.isRequired,
  lens: PropTypes.string,
};
