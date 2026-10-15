import React, { useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Drawer,
  IconButton,
  Link,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router";
import Iconify from "src/components/iconify";
import {
  analyseReportLink,
  askLink,
} from "src/sections/projects/observeHandoff";
import { UNITS, unitWord } from "src/sections/projects/observePopulation";
import { UNITS_PAGE, collectRunUnits, useRunUnits } from "./analyseApi";
import { isMutedCategory } from "./analyseDistribution";
import {
  formatCost,
  formatCount,
  formatDay,
  formatLatency,
  formatPercent,
  formatSentiment,
  humanizeKey,
  humanizeValue,
} from "./analyseFormat";
import { OUTCOMES } from "./analyseLenses";
import { sortNotable } from "./analyseNotable";
import { useCancellable } from "./analyseHooks";
import { NotableLine, Stat, Swatch } from "./parts";
import UnitList from "./UnitList";

const MOSTLY_ONE_USER = 0.5;

function Section({ title, children, hint }) {
  return (
    <Box>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle2" component="h3">
          {title}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </Stack>
      {children}
    </Box>
  );
}

Section.propTypes = {
  title: PropTypes.node.isRequired,
  children: PropTypes.node,
  hint: PropTypes.node,
};

function OutcomeBars({ outcomes, count, color }) {
  const keys = [
    ...OUTCOMES.filter((key) => outcomes[key]),
    ...Object.keys(outcomes).filter((key) => !OUTCOMES.includes(key)),
  ];
  if (!keys.length) return null;
  return (
    <Stack spacing={0.75}>
      {keys.map((key) => {
        const value = outcomes[key] || 0;
        const share = count ? value / count : 0;
        return (
          <Stack key={key} direction="row" spacing={1.5} alignItems="center">
            <Typography
              variant="caption"
              sx={{ width: 130, flexShrink: 0 }}
              noWrap
            >
              {humanizeValue(key)}
            </Typography>
            <Box
              sx={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                bgcolor: "action.hover",
              }}
            >
              <Box
                sx={{
                  width: `${share * 100}%`,
                  height: "100%",
                  borderRadius: 3,
                  bgcolor: color || "text.secondary",
                }}
              />
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                width: 72,
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatCount(value)} · {formatPercent(share)}
            </Typography>
          </Stack>
        );
      })}
    </Stack>
  );
}

OutcomeBars.propTypes = {
  outcomes: PropTypes.object.isRequired,
  count: PropTypes.number,
  color: PropTypes.string,
};

function AttributeSummary({ attributes }) {
  const entries = Object.entries(attributes || {});
  if (!entries.length) return null;
  return (
    <Stack spacing={1}>
      {entries.map(([key, summary]) => (
        <Stack key={key} direction="row" spacing={1.5} alignItems="baseline">
          <Typography
            variant="body2"
            sx={{ width: 180, flexShrink: 0 }}
            noWrap
            title={key}
          >
            {humanizeKey(key)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {summary.type === "boolean"
              ? `${formatPercent(summary.rate)} true`
              : summary.type === "number"
                ? `mean ${Number(summary.mean).toFixed(1)}`
                : (summary.top || [])
                    .map(
                      (entry) => `${entry.value} (${formatCount(entry.count)})`,
                    )
                    .join(", ")}
            <Box component="span" sx={{ color: "text.disabled" }}>
              {" "}
              · n={formatCount(summary.n)}
            </Box>
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

AttributeSummary.propTypes = { attributes: PropTypes.object };

// Every day of the report's window, so quiet days show as gaps.
function dayRange(daily, reportDaily) {
  const keys = Object.keys({ ...(reportDaily || {}), ...(daily || {}) }).sort();
  if (!keys.length) return [];
  const days = [];
  const end = new Date(`${keys[keys.length - 1]}T00:00:00Z`);
  for (
    let day = new Date(`${keys[0]}T00:00:00Z`);
    day <= end && days.length < 120;
    day = new Date(day.getTime() + 86400000)
  ) {
    const key = day.toISOString().slice(0, 10);
    days.push({ key, count: daily?.[key] || 0 });
  }
  return days;
}

function DailyBars({ daily, reportDaily, color }) {
  const days = dayRange(daily, reportDaily);
  if (days.length < 2) return null;
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <Box>
      <Stack
        direction="row"
        alignItems="flex-end"
        sx={{ height: 48, gap: "2px" }}
        role="img"
        aria-label={days.map((d) => `${d.key}: ${d.count}`).join(", ")}
      >
        {days.map((day) => (
          <Tooltip
            describeChild
            describeChild
            key={day.key}
            arrow
            title={`${formatDay(`${day.key}T12:00:00Z`)}: ${formatCount(day.count)}`}
          >
            <Box
              sx={{
                flex: 1,
                height: day.count
                  ? `${Math.max(8, (day.count / max) * 100)}%`
                  : "2px",
                bgcolor: day.count ? color || "text.secondary" : "divider",
                borderRadius: "3px 3px 0 0",
              }}
            />
          </Tooltip>
        ))}
      </Stack>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {formatDay(`${days[0].key}T12:00:00Z`)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {formatDay(`${days[days.length - 1].key}T12:00:00Z`)}
        </Typography>
      </Stack>
    </Box>
  );
}

DailyBars.propTypes = {
  daily: PropTypes.object,
  reportDaily: PropTypes.object,
  color: PropTypes.string,
};

function StatsGrid({ stats, unit }) {
  const count = stats.count || 0;
  const tiles = [
    { label: "Count", value: formatCount(count) },
    {
      label: "Share",
      value: formatPercent(stats.share),
      hint: stats.share_ci
        ? `95% CI ${formatPercent(stats.share_ci[0])}–${formatPercent(stats.share_ci[1])}`
        : undefined,
    },
    unit !== "users" && {
      label: "Users affected",
      value: formatCount(stats.users),
      hint:
        (stats.top_user_share || 0) > MOSTLY_ONE_USER
          ? `Mostly one user (${formatPercent(stats.top_user_share)})`
          : undefined,
      tone:
        (stats.top_user_share || 0) > MOSTLY_ONE_USER ? "warning" : undefined,
    },
    unit === "traces" &&
      stats.sessions > 0 && {
        label: "Sessions",
        value: formatCount(stats.sessions),
      },
    count > 0 &&
      Number.isFinite(stats.turns) && {
        label: "Turns",
        value: (stats.turns / count).toFixed(1),
        hint: "average",
      },
    { label: "Agent failure", value: formatPercent(stats.failure_rate) },
    { label: "Unresolved", value: formatPercent(stats.unresolved_rate) },
    { label: "Errors", value: formatPercent(stats.error_rate) },
    {
      label: "Sentiment",
      value: formatSentiment(stats.sentiment),
      hint: "average, 1 to 5",
    },
    Number.isFinite(stats.latency_ms) && {
      label: "Latency",
      value: formatLatency(stats.latency_ms),
      hint: "median",
    },
    stats.cost > 0 && {
      label: "Cost",
      value: formatCost(stats.cost),
      hint: "average",
    },
  ].filter(Boolean);
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 2,
      }}
    >
      {tiles.map((tile) => (
        <Stat
          key={tile.label}
          label={tile.label}
          value={tile.value}
          hint={tile.hint}
          tone={tile.tone}
        />
      ))}
    </Box>
  );
}

StatsGrid.propTypes = {
  stats: PropTypes.object.isRequired,
  unit: PropTypes.string,
};

function CategoryContent({
  category,
  parent,
  childCategories,
  projectId,
  runId,
  unit,
  reportName,
  reportDaily,
  colorOf,
  onCategory,
  onUnit,
}) {
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const stats = category.stats || {};
  const color = colorOf(parent?.id || category.id);
  const params =
    category.level === 1
      ? { category_id: category.id }
      : { sub_category_id: category.id };
  const units = useRunUnits(runId, { ...params, offset, limit: UNITS_PAGE });
  const notable = sortNotable(category.notable);
  const plural = (UNITS[unit] || UNITS.traces).plural;
  const collecting = useCancellable("The examples could not be collected.");

  const measure = () =>
    navigate(
      askLink(projectId, {
        unit,
        label: category.name,
        questions: [
          {
            question:
              `Is this an example of “${category.name}”? ${category.description || ""}`.trim(),
            answerType: "yes_no",
          },
        ],
      }),
    );

  const analyseThis = () =>
    collecting.run(async (signal) => {
      const rows = await collectRunUnits(runId, params, signal);
      navigate(
        analyseReportLink(projectId, {
          unit,
          population: rows.map((row) => ({
            id: row.unit_id,
            time: row.time || "",
            user_id: row.user_id || "",
          })),
          question: `Within “${category.name}”, what distinct patterns are there and what causes them?`,
          label: `${category.name} · ${reportName}`,
          source: reportName,
        }),
      );
      return rows.length;
    });

  return (
    <Stack spacing={2.5}>
      <Box>
        {parent && (
          <Breadcrumbs
            separator={<Iconify icon="mdi:chevron-right" width={14} />}
            sx={{ mb: 0.75, "& .MuiBreadcrumbs-li": { minWidth: 0 } }}
          >
            <Link
              component="button"
              type="button"
              variant="caption"
              color="text.secondary"
              underline="hover"
              onClick={() => onCategory(parent.id)}
              sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
            >
              <Swatch color={color} size={8} />
              {parent.name}
            </Link>
            <Typography variant="caption" color="text.primary" noWrap>
              {category.name}
            </Typography>
          </Breadcrumbs>
        )}
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          {!parent && <Swatch color={color} size={12} />}
          <Typography variant="h6" component="h2" sx={{ lineHeight: 1.3 }}>
            {category.name}
          </Typography>
          {category.status === "emerging" && (
            <Chip
              size="small"
              label="New"
              color="info"
              variant="outlined"
              sx={{ height: 20 }}
            />
          )}
          {isMutedCategory(category) && (
            <Chip
              size="small"
              label="Didn't fit the categories"
              sx={{ height: 20 }}
            />
          )}
        </Stack>
        {category.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {category.description}
          </Typography>
        )}
      </Box>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Tooltip
          describeChild
          describeChild
          arrow
          title={`Opens Instant eval on ${plural} with this as a yes/no question, to measure it across all your traffic and keep tracking it.`}
        >
          <Button
            size="small"
            variant="outlined"
            startIcon={<Iconify icon="mdi:creation-outline" width={16} />}
            onClick={measure}
          >
            Measure with Jev
          </Button>
        </Tooltip>
        <Tooltip
          describeChild
          describeChild
          arrow
          title={`A new report on just these ${formatCount(stats.count)} ${plural}, to find the patterns inside this category.`}
        >
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={
                collecting.state.status === "busy" ? (
                  <CircularProgress size={14} />
                ) : (
                  <Iconify icon="mdi:file-tree-outline" width={16} />
                )
              }
              onClick={analyseThis}
              disabled={collecting.state.status === "busy" || !stats.count}
            >
              Analyse this category
            </Button>
          </span>
        </Tooltip>
      </Stack>
      {collecting.state.status === "error" && (
        <Alert severity="error" onClose={collecting.reset}>
          {collecting.state.error}
        </Alert>
      )}

      <StatsGrid stats={stats} unit={unit} />

      <Section title="Notable differences" hint="vs the rest of this report">
        {notable.length ? (
          <Stack spacing={1.25}>
            {notable.map((note) => (
              <NotableLine key={`${note.metric}-${note.kind}`} note={note} />
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Nothing here differs clearly from the rest of the report once every
            comparison is accounted for.
          </Typography>
        )}
      </Section>

      {stats.outcomes && Object.keys(stats.outcomes).length > 0 && (
        <Section title="How they ended">
          <OutcomeBars
            outcomes={stats.outcomes}
            count={stats.count}
            color={color}
          />
        </Section>
      )}

      {stats.attributes && Object.keys(stats.attributes).length > 0 && (
        <Section title="Attributes">
          <AttributeSummary attributes={stats.attributes} />
        </Section>
      )}

      {stats.daily && (
        <Section title="By day">
          <DailyBars
            daily={stats.daily}
            reportDaily={reportDaily}
            color={color}
          />
        </Section>
      )}

      {childCategories.length > 0 && (
        <Section title="Subcategories">
          <Stack spacing={0.5}>
            {childCategories.map((child) => (
              <Stack
                key={child.id}
                direction="row"
                spacing={1}
                alignItems="center"
                component="button"
                type="button"
                onClick={() => onCategory(child.id)}
                sx={{
                  p: 0.75,
                  mx: -0.75,
                  border: 0,
                  borderRadius: 1,
                  bgcolor: "transparent",
                  font: "inherit",
                  color: "text.primary",
                  textAlign: "left",
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Swatch color={color} size={8} />
                <Typography
                  variant="body2"
                  sx={{ flex: 1, minWidth: 0 }}
                  noWrap
                >
                  {child.name}
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatCount(child.stats?.count)} ·{" "}
                  {formatPercent(child.stats?.share)}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Section>
      )}

      <Section
        title="Examples"
        hint={`${formatCount(stats.count)} ${unitWord(unit, stats.count)}, oldest first`}
      >
        <UnitList
          query={units}
          offset={offset}
          pageSize={UNITS_PAGE}
          onOffset={setOffset}
          onOpen={onUnit}
          emptyText="No examples in this category."
        />
      </Section>
    </Stack>
  );
}

CategoryContent.propTypes = {
  category: PropTypes.object.isRequired,
  parent: PropTypes.object,
  childCategories: PropTypes.array.isRequired,
  projectId: PropTypes.string.isRequired,
  runId: PropTypes.string.isRequired,
  unit: PropTypes.string,
  reportName: PropTypes.string,
  reportDaily: PropTypes.object,
  colorOf: PropTypes.func.isRequired,
  onCategory: PropTypes.func.isRequired,
  onUnit: PropTypes.func.isRequired,
};

export default function CategoryDrawer({ open, onClose, category, ...rest }) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: 600, maxWidth: "100vw" } }}
    >
      <Stack sx={{ height: "100%" }}>
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            px: 2.5,
            py: 1.5,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ flex: 1 }}
          >
            Category
          </Typography>
          <IconButton
            aria-label="Close category"
            onClick={onClose}
            size="small"
          >
            <Iconify icon="mdi:close" width={18} />
          </IconButton>
        </Stack>
        <Box sx={{ flex: 1, overflowY: "auto", px: 2.5, py: 2.5 }}>
          {category && (
            <CategoryContent key={category.id} category={category} {...rest} />
          )}
        </Box>
      </Stack>
    </Drawer>
  );
}

CategoryDrawer.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  category: PropTypes.object,
};
