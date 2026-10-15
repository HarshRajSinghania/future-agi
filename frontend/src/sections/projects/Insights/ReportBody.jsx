import React, { useCallback, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Box, Button, Collapse, Paper, Stack, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { unitWord } from "src/sections/projects/observePopulation";
import { buildRefIndex } from "./insightsCitations";
import {
  OTHER_COLOR,
  buildCategoryTree,
  buildColorOrder,
  buildSegments,
  buildTrend,
  categoryRowId,
  colorFor,
  isMutedCategory,
  resultTops,
} from "./insightsDistribution";
import {
  formatCost,
  formatCount,
  formatDuration,
  formatWhen,
  humanizeKey,
} from "./insightsFormat";
import { lensFor } from "./insightsLenses";
import CategoryDrawer from "./CategoryDrawer";
import CategoryTable from "./CategoryTable";
import DistributionCard from "./DistributionCard";
import ExecutiveSummary, { Highlights } from "./ExecutiveSummary";
import StatStrip from "./StatStrip";
import UnitDrawer from "./UnitDrawer";

function MethodNote({ run, config }) {
  const [open, setOpen] = useState(false);
  const settings = run.settings || {};
  const result = run.result || {};
  const models = run.models_used || {};
  const rows = [
    ["Question", settings.question || config?.question],
    ["Lens", lensFor(settings.lens || config?.lens).title],
    ["Scope", run.scope?.label],
    [
      "Sample",
      `${formatCount(run.sample_size)} of ${formatCount(run.population_size)} ${unitWord(
        run.unit,
        run.population_size,
      )}, spread evenly over time`,
    ],
    [
      "Categories",
      run.taxonomy_mode === "classify"
        ? "Sorted into the report's saved categories"
        : `Discovered in this run${result.clustering?.k ? ` from ${result.clustering.k} groups` : ""}`,
    ],
    ["What the agent does", settings.agent_description],
    ["Instructions", settings.instructions],
    [
      "Attributes",
      (settings.attributes || [])
        .map(
          (a) =>
            `${humanizeKey(a.key)} (${a.type}${a.filter_by ? ", filters" : ""})`,
        )
        .join(", "),
    ],
    [
      "Models",
      [
        models.fast && `read by ${models.fast}`,
        models.thinking && `grouped and written by ${models.thinking}`,
      ]
        .filter(Boolean)
        .join(", "),
    ],
    [
      "Ran",
      `${formatWhen(run.started_at || run.created_at)}${
        run.finished_at
          ? ` · took ${formatDuration(run.started_at || run.created_at, run.finished_at)}`
          : ""
      }${run.cost_usd > 0 ? ` · ${formatCost(run.cost_usd)}` : ""}`,
    ],
  ].filter(([, value]) => value);
  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5 }}>
      <Button
        fullWidth
        color="inherit"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        startIcon={
          <Iconify
            icon={open ? "mdi:chevron-down" : "mdi:chevron-right"}
            width={18}
          />
        }
        sx={{ justifyContent: "flex-start", px: 2, py: 1.25, fontWeight: 600 }}
      >
        How this report was made
      </Button>
      <Collapse in={open}>
        <Box
          component="dl"
          sx={{
            m: 0,
            px: 2.5,
            pb: 2,
            display: "grid",
            gridTemplateColumns: "180px 1fr",
            rowGap: 1,
            columnGap: 2,
          }}
        >
          {rows.map(([label, value]) => (
            <React.Fragment key={label}>
              <Typography component="dt" variant="body2" color="text.secondary">
                {label}
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                {value}
              </Typography>
            </React.Fragment>
          ))}
        </Box>
      </Collapse>
    </Paper>
  );
}

MethodNote.propTypes = {
  run: PropTypes.object.isRequired,
  config: PropTypes.object,
};

/**
 * A completed run: summary, stats, distribution, categories and highlights,
 * with the category and example drawers. Which drawer is open lives in the
 * URL (`category`, `example`) so a link opens straight to it.
 */
export default function ReportBody({
  projectId,
  config,
  run,
  categoryId,
  exampleId,
  onDrawer,
  onSelectRun,
}) {
  const theme = useTheme();
  const mode = theme.palette.mode;
  const result = run.result || {};
  const unit = run.unit;
  const lens = run.settings?.lens || config?.lens;
  const categories = useMemo(
    () => result.categories || [],
    [result.categories],
  );
  const categoriesById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const order = useMemo(
    () =>
      buildColorOrder({
        taxonomy: config?.taxonomy,
        runs: config?.runs || [],
        extra: resultTops(categories),
      }),
    [config, categories],
  );
  const otherColor = OTHER_COLOR[mode] || OTHER_COLOR.light;
  const colorOf = useCallback(
    (id) => {
      const category = categoriesById.get(id);
      const topId = category?.level === 2 ? category.parent_id : id;
      const top = categoriesById.get(topId) || category;
      if (top && isMutedCategory(top)) return otherColor;
      return colorFor(topId, order, mode) || otherColor;
    },
    [categoriesById, order, mode, otherColor],
  );
  const segments = useMemo(
    () => buildSegments(resultTops(categories), { order, mode }),
    [categories, order, mode],
  );
  const trend = useMemo(
    () => buildTrend(config?.runs || [], { order, mode }),
    [config, order, mode],
  );
  const sharedTaxonomy = (config?.runs || [])
    .filter((r) => r.status === "completed")
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(1)
    .every((r) => r.taxonomy_mode === "classify");
  const refIndex = useMemo(
    () => buildRefIndex(result.summary),
    [result.summary],
  );

  const [expanded, setExpanded] = useState(() => new Set());
  const [highlightId, setHighlightId] = useState(null);
  const [unitRow, setUnitRow] = useState(null);

  const toggle = useCallback((id) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openCategory = useCallback(
    (id, { reveal = true } = {}) => {
      const category = categoriesById.get(id);
      if (!category) return;
      if (category.level === 2 && category.parent_id)
        setExpanded((current) => new Set(current).add(category.parent_id));
      onDrawer({ category: id, example: null });
      if (reveal) {
        setHighlightId(id);
        setTimeout(() => {
          document
            .getElementById(categoryRowId(id))
            ?.scrollIntoView?.({ behavior: "smooth", block: "center" });
        }, 50);
        setTimeout(() => setHighlightId(null), 2400);
      }
    },
    [categoriesById, onDrawer],
  );

  const openUnit = useCallback(
    (row) => {
      setUnitRow(row);
      onDrawer({ example: row.unit_id });
    },
    [onDrawer],
  );

  const cite = useCallback(
    (n, unitId) => {
      const target = unitId || refIndex.get(n)?.unitId;
      if (!target) return;
      setUnitRow(null);
      onDrawer({ example: target });
    },
    [refIndex, onDrawer],
  );

  const category = categoryId ? categoriesById.get(categoryId) : null;
  const parent = category?.parent_id
    ? categoriesById.get(category.parent_id)
    : null;
  const childCategories = useMemo(
    () =>
      category?.level === 1
        ? tree.find((row) => row.id === category.id)?.childRows || []
        : [],
    [category, tree],
  );

  if (!categories.length) {
    return (
      <Stack spacing={2}>
        <StatStrip run={run} lens={lens} />
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 1.5 }}>
          <Typography variant="subtitle1">No categories in this run</Typography>
          <Typography variant="body2" color="text.secondary">
            None of the {formatCount(run.sample_size)}{" "}
            {unitWord(unit, run.sample_size)} sampled matched the question. Try
            a wider window, a different lens, or remove an attribute that
            filters.
          </Typography>
        </Paper>
        <MethodNote run={run} config={config} />
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <ExecutiveSummary
        summary={result.summary}
        refIndex={refIndex}
        categoriesById={categoriesById}
        colorOf={colorOf}
        onCite={cite}
        onCategory={openCategory}
      />
      <StatStrip run={run} lens={lens} />
      <DistributionCard
        unit={unit}
        analysed={result.totals?.count ?? run.analysed_count}
        segments={segments}
        trend={trend}
        sharedTaxonomy={sharedTaxonomy}
        currentRunId={run.id}
        onCategory={(id) => openCategory(id)}
        onSelectRun={onSelectRun}
      />
      <CategoryTable
        tree={tree}
        unit={unit}
        lens={lens}
        colorOf={colorOf}
        expanded={expanded}
        onToggle={toggle}
        onOpen={(id) => openCategory(id, { reveal: false })}
        highlightId={highlightId}
      />
      <Highlights
        highlights={result.summary?.highlights}
        categoriesById={categoriesById}
        colorOf={colorOf}
        onCite={cite}
        onCategory={openCategory}
      />
      <MethodNote run={run} config={config} />

      <CategoryDrawer
        open={Boolean(category)}
        onClose={() => onDrawer({ category: null, example: null })}
        category={category}
        parent={parent}
        childCategories={childCategories}
        projectId={projectId}
        runId={run.id}
        unit={unit}
        reportName={config?.name || run.settings?.name || "this report"}
        reportDaily={result.totals?.daily}
        colorOf={colorOf}
        onCategory={(id) => openCategory(id, { reveal: false })}
        onUnit={openUnit}
      />
      <UnitDrawer
        open={Boolean(exampleId)}
        onClose={() => onDrawer({ example: null })}
        projectId={projectId}
        runId={run.id}
        unit={unit}
        unitId={exampleId}
        row={unitRow?.unit_id === exampleId ? unitRow : null}
        categoriesById={categoriesById}
        colorOf={colorOf}
        onCategory={(id) => openCategory(id, { reveal: false })}
      />
    </Stack>
  );
}

ReportBody.propTypes = {
  projectId: PropTypes.string.isRequired,
  config: PropTypes.object,
  run: PropTypes.object.isRequired,
  categoryId: PropTypes.string,
  exampleId: PropTypes.string,
  onDrawer: PropTypes.func.isRequired,
  onSelectRun: PropTypes.func.isRequired,
};
