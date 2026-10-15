import React from "react";
import PropTypes from "prop-types";
import { Box, Divider, Stack, Typography } from "@mui/material";
import { UNITS } from "src/sections/projects/observePopulation";
import { formatCount, formatWhen } from "./analyseFormat";
import { Legend, SectionCard, StackedBar } from "./parts";

function TrendRows({ rows, currentRunId, onSelectRun }) {
  return (
    <Stack spacing={0.75}>
      {rows.map((row) => {
        const current = row.runId === currentRunId;
        return (
          <Stack
            key={row.runId}
            direction="row"
            spacing={1.5}
            alignItems="center"
            component="button"
            type="button"
            onClick={() => onSelectRun(row.runId)}
            aria-current={current ? "true" : undefined}
            aria-label={`Open the run of ${formatWhen(row.createdAt)}`}
            sx={{
              p: 0.5,
              mx: -0.5,
              border: 0,
              borderRadius: 1,
              bgcolor: current ? "action.selected" : "transparent",
              font: "inherit",
              color: "text.primary",
              cursor: "pointer",
              textAlign: "left",
              "&:hover": { bgcolor: "action.hover" },
              "&:focus-visible": {
                outline: "2px solid",
                outlineColor: "primary.main",
              },
            }}
          >
            <Typography
              variant="caption"
              fontWeight={current ? 600 : 400}
              sx={{ width: 128, flexShrink: 0 }}
              noWrap
            >
              {formatWhen(row.createdAt)}
            </Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <StackedBar segments={row.segments} height={10} />
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                width: 56,
                textAlign: "right",
                flexShrink: 0,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              n={formatCount(row.count)}
            </Typography>
          </Stack>
        );
      })}
    </Stack>
  );
}

TrendRows.propTypes = {
  rows: PropTypes.array.isRequired,
  currentRunId: PropTypes.string,
  onSelectRun: PropTypes.func.isRequired,
};

export default function DistributionCard({
  unit,
  analysed,
  segments,
  trend,
  sharedTaxonomy,
  currentRunId,
  onCategory,
  onSelectRun,
}) {
  const plural = (UNITS[unit] || UNITS.traces).plural;
  return (
    <SectionCard
      title="Distribution"
      subtitle={`Share of the ${formatCount(analysed)} ${plural} analysed, by top-level category. Click a category to open it.`}
    >
      <Stack spacing={1.5}>
        <StackedBar
          segments={segments}
          height={14}
          onSegmentClick={onCategory}
        />
        <Legend segments={segments} onClick={onCategory} />
      </Stack>
      {trend.length >= 2 && (
        <>
          <Divider sx={{ my: 2.5 }} />
          <Typography variant="subtitle2">Across runs</Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 1.5 }}
          >
            {sharedTaxonomy
              ? "Every run uses this report's saved categories, so the shares compare run to run."
              : "Some runs discovered their own categories; only the colours they share compare."}{" "}
            Click a run to open it.
          </Typography>
          <TrendRows
            rows={trend}
            currentRunId={currentRunId}
            onSelectRun={onSelectRun}
          />
        </>
      )}
    </SectionCard>
  );
}

DistributionCard.propTypes = {
  unit: PropTypes.string,
  analysed: PropTypes.number,
  segments: PropTypes.array.isRequired,
  trend: PropTypes.array.isRequired,
  sharedTaxonomy: PropTypes.bool,
  currentRunId: PropTypes.string,
  onCategory: PropTypes.func.isRequired,
  onSelectRun: PropTypes.func.isRequired,
};
