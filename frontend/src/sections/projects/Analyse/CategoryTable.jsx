import React, { useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Box,
  Chip,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import {
  categoryRowId,
  isMutedCategory,
  sortCategoryTree,
} from "./analyseDistribution";
import { formatCount, formatPercent, formatSentiment } from "./analyseFormat";
import { sortNotable } from "./analyseNotable";
import { NotableChip, SectionCard, Swatch } from "./parts";

const MOSTLY_ONE_USER = 0.5;
const NOTABLE_IN_ROW = 2;

function ShareCell({ stats, color }) {
  const share = stats?.share || 0;
  const ci = stats?.share_ci;
  const bar = (
    <Stack direction="row" spacing={1} alignItems="center">
      <Box
        sx={{
          position: "relative",
          width: 88,
          height: 6,
          borderRadius: 3,
          bgcolor: "action.hover",
          flexShrink: 0,
        }}
      >
        {ci && (
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              left: `${ci[0] * 100}%`,
              width: `${Math.max(0, ci[1] - ci[0]) * 100}%`,
              top: -2,
              bottom: -2,
              borderRadius: 1,
              bgcolor: alpha(color || "#999", 0.18),
            }}
          />
        )}
        <Box
          sx={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${share * 100}%`,
            borderRadius: 3,
            bgcolor: color || "grey.500",
          }}
        />
      </Box>
      <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {formatPercent(share)}
      </Typography>
    </Stack>
  );
  return ci ? (
    <Tooltip
      describeChild
      describeChild
      arrow
      title={`95% CI ${formatPercent(ci[0])}–${formatPercent(ci[1])}: with this sample size, the true share is very likely in this range.`}
    >
      {bar}
    </Tooltip>
  ) : (
    bar
  );
}

ShareCell.propTypes = { stats: PropTypes.object, color: PropTypes.string };

const COLUMNS = [
  { key: "count", label: "Count", align: "right", width: 72 },
  { key: "share", label: "Share", sortKey: "count", width: 150 },
  {
    key: "users",
    label: "Users",
    align: "right",
    width: 76,
    help: "Users affected: distinct users with at least one item here.",
  },
  {
    key: "failure",
    label: "Failure",
    align: "right",
    width: 76,
    help: "Share with an agent mistake.",
  },
  {
    key: "unresolved",
    label: "Unresolved",
    align: "right",
    width: 96,
    help: "Share that ended unresolved or abandoned.",
  },
  {
    key: "sentiment",
    label: "Sentiment",
    align: "right",
    width: 88,
    help: "Average user sentiment, 1 (very negative) to 5 (very positive).",
  },
  {
    key: "notable",
    label: "Notable differences",
    width: 300,
    help: "Where this category differs from the rest of the report, after correcting for every comparison made.",
  },
];

function CategoryRow({
  category,
  child,
  color,
  columns,
  expandable,
  expanded,
  onToggle,
  onOpen,
  highlighted,
}) {
  const stats = category.stats || {};
  const muted = isMutedCategory(category);
  const notable = sortNotable(category.notable);
  const mostlyOne = (stats.top_user_share || 0) > MOSTLY_ONE_USER;
  const open = () => onOpen(category.id);
  const cells = {
    count: formatCount(stats.count),
    share: <ShareCell stats={stats} color={color} />,
    users: (
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        justifyContent="flex-end"
      >
        {mostlyOne && (
          <Tooltip
            describeChild
            describeChild
            arrow
            title={`Mostly one user: ${formatPercent(stats.top_user_share)} of this category comes from a single user.`}
          >
            <Iconify
              icon="mdi:account-alert-outline"
              width={15}
              sx={{ color: "warning.icon" }}
              aria-label="Mostly one user"
            />
          </Tooltip>
        )}
        <span>{formatCount(stats.users)}</span>
      </Stack>
    ),
    failure: formatPercent(stats.failure_rate),
    unresolved: formatPercent(stats.unresolved_rate),
    sentiment: formatSentiment(stats.sentiment),
    notable: notable.length ? (
      <Stack
        direction="row"
        spacing={0.5}
        useFlexGap
        flexWrap="wrap"
        alignItems="center"
      >
        {notable.slice(0, NOTABLE_IN_ROW).map((note) => (
          <NotableChip key={`${note.metric}-${note.kind}`} note={note} />
        ))}
        {notable.length > NOTABLE_IN_ROW && (
          <Typography variant="caption" color="text.secondary">
            +{notable.length - NOTABLE_IN_ROW} more
          </Typography>
        )}
      </Stack>
    ) : (
      <Typography variant="caption" color="text.disabled">
        –
      </Typography>
    ),
  };

  return (
    <TableRow
      id={categoryRowId(category.id)}
      hover
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
        if (expandable && event.key === "ArrowRight" && !expanded)
          onToggle(category.id);
        if (expandable && event.key === "ArrowLeft" && expanded)
          onToggle(category.id);
      }}
      aria-label={`${category.name}: ${formatCount(stats.count)} (${formatPercent(stats.share)})`}
      sx={{
        cursor: "pointer",
        verticalAlign: "top",
        transition: "background-color 600ms",
        bgcolor: highlighted ? "action.selected" : undefined,
        "& > td": { color: muted ? "text.secondary" : undefined },
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: -2,
        },
      }}
    >
      <TableCell padding="none" sx={{ width: 40, pl: 1 }}>
        {expandable && (
          <IconButton
            size="small"
            aria-label={`${expanded ? "Hide" : "Show"} subcategories of ${category.name}`}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(category.id);
            }}
            sx={{ mt: 0.5 }}
          >
            <Iconify
              icon={expanded ? "mdi:chevron-down" : "mdi:chevron-right"}
              width={18}
            />
          </IconButton>
        )}
      </TableCell>
      <TableCell sx={{ pl: child ? 3.5 : 1, minWidth: 280 }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ pt: "6px" }}>
            <Swatch
              color={child && color ? alpha(color, 0.55) : color}
              size={child ? 8 : 10}
            />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Stack
              direction="row"
              spacing={0.75}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Typography variant="subtitle2" fontWeight={child ? 500 : 600}>
                {category.name}
              </Typography>
              {category.status === "emerging" && (
                <Tooltip
                  describeChild
                  describeChild
                  arrow
                  title="New in this run: these items did not fit the report's saved categories."
                >
                  <Chip
                    size="small"
                    label="New"
                    color="info"
                    variant="outlined"
                    sx={{ height: 18, fontSize: 10, borderRadius: 0.75 }}
                  />
                </Tooltip>
              )}
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              title={category.description}
              sx={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {category.description}
            </Typography>
          </Box>
        </Stack>
      </TableCell>
      {columns.map((column) => (
        <TableCell
          key={column.key}
          align={column.align}
          sx={{
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            pt: 1.5,
          }}
        >
          {cells[column.key]}
        </TableCell>
      ))}
    </TableRow>
  );
}

CategoryRow.propTypes = {
  category: PropTypes.object.isRequired,
  child: PropTypes.bool,
  color: PropTypes.string,
  columns: PropTypes.array.isRequired,
  expandable: PropTypes.bool,
  expanded: PropTypes.bool,
  onToggle: PropTypes.func,
  onOpen: PropTypes.func.isRequired,
  highlighted: PropTypes.bool,
};

export default function CategoryTable({
  tree,
  unit,
  lens,
  colorOf,
  expanded,
  onToggle,
  onOpen,
  highlightId,
}) {
  const [sort, setSort] = useState({ key: "count", direction: "desc" });
  const columns = useMemo(
    () =>
      COLUMNS.filter(
        (column) =>
          !(column.key === "users" && unit === "users") &&
          !(column.key === "failure" && lens === "failures"),
      ),
    [unit, lens],
  );
  const rows = useMemo(
    () => sortCategoryTree(tree, sort.key, sort.direction),
    [tree, sort],
  );
  const allExpandable = tree
    .filter((row) => row.expandable)
    .map((row) => row.id);
  const allOpen =
    allExpandable.length > 0 && allExpandable.every((id) => expanded.has(id));

  const sortBy = (key) =>
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));

  return (
    <SectionCard
      id="analyse-categories"
      title="Categories"
      subtitle="Each row opens its examples. Expand a category to see its subcategories."
      action={
        allExpandable.length > 0 && (
          <Box
            component="button"
            type="button"
            onClick={() =>
              allExpandable.forEach((id) => {
                if (allOpen === expanded.has(id)) onToggle(id);
              })
            }
            sx={{
              border: 0,
              bgcolor: "transparent",
              color: "text.secondary",
              font: "inherit",
              fontSize: 13,
              cursor: "pointer",
              whiteSpace: "nowrap",
              "&:hover": { color: "text.primary" },
            }}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </Box>
        )
      }
      flush
    >
      <Box sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ "& td, & th": { borderColor: "divider" } }}>
          <TableHead>
            <TableRow>
              <TableCell padding="none" sx={{ width: 40 }} />
              <TableCell sx={{ pl: 1 }}>Category</TableCell>
              {columns.map((column) => {
                const sortKey = column.sortKey || column.key;
                const label = (
                  <TableSortLabel
                    active={sort.key === sortKey}
                    direction={sort.key === sortKey ? sort.direction : "desc"}
                    onClick={() => sortBy(sortKey)}
                  >
                    {column.label}
                  </TableSortLabel>
                );
                return (
                  <TableCell
                    key={column.key}
                    align={column.align}
                    sx={{ width: column.width, whiteSpace: "nowrap" }}
                    sortDirection={
                      sort.key === sortKey ? sort.direction : false
                    }
                  >
                    {column.help ? (
                      <Tooltip describeChild arrow title={column.help}>
                        {label}
                      </Tooltip>
                    ) : (
                      label
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const isOpen = expanded.has(row.id);
              const color = colorOf(row.id);
              return (
                <React.Fragment key={row.id}>
                  <CategoryRow
                    category={row}
                    color={color}
                    columns={columns}
                    expandable={row.expandable}
                    expanded={isOpen}
                    onToggle={onToggle}
                    onOpen={onOpen}
                    highlighted={highlightId === row.id}
                  />
                  {row.expandable &&
                    isOpen &&
                    row.childRows.map((child) => (
                      <CategoryRow
                        key={child.id}
                        category={child}
                        child
                        color={color}
                        columns={columns}
                        onOpen={onOpen}
                        highlighted={highlightId === child.id}
                      />
                    ))}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Box>
    </SectionCard>
  );
}

CategoryTable.propTypes = {
  tree: PropTypes.array.isRequired,
  unit: PropTypes.string,
  lens: PropTypes.string,
  colorOf: PropTypes.func.isRequired,
  expanded: PropTypes.instanceOf(Set).isRequired,
  onToggle: PropTypes.func.isRequired,
  onOpen: PropTypes.func.isRequired,
  highlightId: PropTypes.string,
};
