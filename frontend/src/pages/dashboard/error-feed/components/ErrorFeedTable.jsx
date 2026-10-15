import IssueAgentCell from "src/sections/simulate-v2/errorFeed/IssueAgentCell";
import { useAgentImprovementFlag } from "src/sections/simulate-v2/_mock/featureFlags";
import React, { useCallback, useMemo } from "react";
import {
  Box,
  Checkbox,
  Chip,
  IconButton,
  MenuItem,
  Pagination,
  PaginationItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  useTheme,
  alpha,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNowStrict } from "date-fns";
import Iconify from "src/components/iconify";
import IssueStatusChip from "./IssueStatusChip";
import ErrorSeverityBadge from "./ErrorSeverityBadge";
import ErrorTrendSparkline from "./ErrorTrendSparkline";
import { useErrorFeedList } from "src/api/errorFeed/mockAdapter";
import { useErrorFeedApiParams, useErrorFeedStore } from "../store";
import PropTypes from "prop-types";
import { clickable, focusRing } from "src/sections/simulate-v2/components/clickable";

// ── helpers ────────────────────────────────────────────────────────────────
const fmt = (n) => {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

const humanizeTime = (iso) => {
  if (!iso) return "—";
  try {
    return `${formatDistanceToNowStrict(new Date(iso))} ago`;
  } catch {
    return "—";
  }
};

function ErrorTypeTag({ type, isDark }) {
  const shortType = type
    .replace(/Error$/, "")
    .replace(/([A-Z])/g, " $1")
    .trim();
  return (
    <Chip
      label={shortType}
      size="small"
      sx={{
        height: 18,
        borderRadius: "3px",
        fontSize: "10px",
        fontWeight: 500,
        bgcolor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
        color: isDark ? "#a1a1aa" : "#605C70",
        "& .MuiChip-label": { px: "5px" },
        maxWidth: 140,
        overflow: "hidden",
      }}
    />
  );
}

ErrorTypeTag.propTypes = {
  type: PropTypes.string,
  isDark: PropTypes.bool,
};

// ── Fix layer chip ──────────────────────────────────────────────────────────
const FIX_LAYER_CONFIG = {
  prompt: { label: "Prompt" },
  orchestration: { label: "Orchestration" },
  tools: { label: "Tools" },
  guardrails: { label: "Guardrails" },
  data: { label: "Data" },
  memory: { label: "Memory" },
};

function FixLayerChip({ layer }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const cfg = FIX_LAYER_CONFIG[layer];
  if (!cfg) return <span style={{ color: "#71717a", fontSize: 11 }}>—</span>;
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        px: "8px",
        py: "3px",
        borderRadius: "5px",
        bgcolor: isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.55)",
        border: "1px solid",
        borderColor: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.3)",
        whiteSpace: "nowrap",
      }}
    >
      <Typography
        sx={{
          fontSize: "11px",
          fontWeight: 600,
          color: "#fff",
          lineHeight: 1,
          letterSpacing: "0.01em",
        }}
      >
        {cfg.label}
      </Typography>
    </Box>
  );
}
FixLayerChip.propTypes = { layer: PropTypes.string };

const COLUMNS = [
  {
    id: "error",
    label: "Error",
    sortable: false,
    width: "auto",
    minWidth: 340,
  },
  { id: "severity", label: "Severity", sortable: true, width: 100 },
  { id: "status", label: "Status", sortable: false, width: 150 },
  { id: "traceCount", label: "Traces", sortable: true, width: 85 },
  { id: "usersAffected", label: "Users", sortable: false, width: 75 },
  { id: "fixLayer", label: "Layer", sortable: false, width: 120 },
  { id: "trends", label: "Trend (14d)", sortable: false, width: 130 },
  { id: "lastSeen", label: "Last seen", sortable: true, width: 120 },
];
/* With agent improvement on: which agent each issue belongs to, beside its status. */
const AGENT_COLUMN = { id: "agent", label: "Agent", sortable: false, width: 170 };
const WITH_AGENT = [...COLUMNS.slice(0, 3), AGENT_COLUMN, ...COLUMNS.slice(3)];

function SortIcon({ active, dir }) {
  if (!active)
    return (
      <Iconify
        icon="mdi:unfold-more-horizontal"
        width={13}
        sx={{ opacity: 0.3, ml: 0.25 }}
      />
    );
  return (
    <Iconify
      icon={dir === "asc" ? "mdi:arrow-up" : "mdi:arrow-down"}
      width={13}
      sx={{ ml: 0.25, color: "primary.main" }}
    />
  );
}
SortIcon.propTypes = { active: PropTypes.bool, dir: PropTypes.string };

// ── skeleton rows ──────────────────────────────────────────────────────────
/* eslint-disable-next-line react/prop-types */
function SkeletonRow({ withAgent = false }) {
  const theme = useTheme();
  const pulse = {
    bgcolor:
      theme.palette.mode === "dark" ? alpha("#fff", 0.06) : alpha("#000", 0.06),
    borderRadius: "4px",
    animation: "pulse 1.4s ease-in-out infinite",
    "@keyframes pulse": {
      "0%,100%": { opacity: 1 },
      "50%": { opacity: 0.4 },
    },
  };
  return (
    <TableRow sx={{ height: 56 }}>
      <TableCell padding="checkbox">
        <Checkbox disabled size="small" />
      </TableCell>
      <TableCell>
        <Box sx={{ ...pulse, height: 14, width: "85%" }} />
      </TableCell>
      <TableCell>
        <Box sx={{ ...pulse, height: 14, width: 60 }} />
      </TableCell>
      <TableCell>
        <Box sx={{ ...pulse, height: 20, width: 70, borderRadius: "4px" }} />
      </TableCell>
      {withAgent && (
        <TableCell>
          <Box sx={{ ...pulse, height: 14, width: 90 }} />
        </TableCell>
      )}
      <TableCell>
        <Box sx={{ ...pulse, height: 14, width: 40 }} />
      </TableCell>
      <TableCell>
        <Box sx={{ ...pulse, height: 14, width: 35 }} />
      </TableCell>
      <TableCell>
        <Box sx={{ ...pulse, height: 14, width: 35 }} />
      </TableCell>
      <TableCell>
        <Box sx={{ ...pulse, height: 20, width: 90, borderRadius: "5px" }} />
      </TableCell>
      <TableCell>
        <Box sx={{ ...pulse, height: 36, width: "100%" }} />
      </TableCell>
      <TableCell>
        <Box sx={{ ...pulse, height: 12, width: 80 }} />
      </TableCell>
    </TableRow>
  );
}

// ── empty state ────────────────────────────────────────────────────────────
function EmptyState({ filtered, colSpan = 9 }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} align="center" sx={{ py: 8 }}>
        <Stack alignItems="center" gap={1.5}>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              bgcolor: "action.hover",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Iconify
              icon="mdi:check-circle-outline"
              width={24}
              sx={{ color: "text.disabled" }}
            />
          </Box>
          <Typography
            typography="m3"
            color="text.primary"
            fontWeight="fontWeightMedium"
          >
            {filtered
              ? "No errors match your filters"
              : "No errors — everything looks good!"}
          </Typography>
          <Typography typography="s2" color="text.secondary">
            {filtered
              ? "Try adjusting your search or filter criteria."
              : "Errors captured by Future AGI will appear here."}
          </Typography>
        </Stack>
      </TableCell>
    </TableRow>
  );
}
EmptyState.propTypes = { filtered: PropTypes.bool, colSpan: PropTypes.number };

// ── main component ─────────────────────────────────────────────────────────
export default function ErrorFeedTable({ selected, onSelect, onSelectAll }) {
  const theme = useTheme();
  const improving = useAgentImprovementFlag();
  const columns = improving ? WITH_AGENT : COLUMNS;
  const isDark = theme.palette.mode === "dark";
  const navigate = useNavigate();
  const { sortBy, sortDir, setSortBy, page, pageSize, setPage } =
    useErrorFeedStore();

  const apiParams = useErrorFeedApiParams();
  const { data, isLoading } = useErrorFeedList(apiParams);

  const isFiltered = useErrorFeedStore(
    (s) =>
      !!(
        s.searchQuery ||
        s.selectedProject ||
        s.selectedEnvironment ||
        s.selectedStatus ||
        s.selectedSeverity ||
        s.selectedErrorType
      ),
  );

  const rows = useMemo(() => data?.data ?? [], [data]);
  const totalCount = data?.total ?? 0;

  const handleRowClick = useCallback(
    (clusterId) => {
      navigate(`/dashboard/error-feed/${clusterId}`);
    },
    [navigate],
  );

  const hoverBg = isDark
    ? alpha(theme.palette.common.white, 0.04)
    : alpha(theme.palette.grey[500], 0.04);

  const selectedBg = isDark
    ? alpha(theme.palette.primary.main, 0.12)
    : alpha(theme.palette.primary.main, 0.05);

  return (
    <>
      <TableContainer
        sx={{
          flex: 1,
          overflowX: "auto",
          overflowY: "auto",
        }}
      >
        <Table stickyHeader size="small" sx={{ minWidth: 900 }}>
          {/* ── header ── */}
          <TableHead>
            <TableRow
              sx={{
                /* The product's DataTable header: no fill, a quiet 13px title. */
                "& .MuiTableCell-head": {
                  bgcolor: "background.paper",
                  /* The theme paints table heads with a grey gradient — off. */
                  backgroundImage: "none",
                  /* A sticky cell's border isn't painted in a collapsed table —
                     the divider under the header is drawn as a shadow. */
                  borderBottom: "none",
                  boxShadow: (t) => `inset 0 -1px 0 ${t.palette.divider}`,
                  py: 1.25,
                  px: 1.5,
                  whiteSpace: "nowrap",
                },
              }}
            >
              <TableCell padding="checkbox" sx={{ width: 40 }}>
                <Checkbox
                  size="small"
                  indeterminate={
                    selected.length > 0 && selected.length < rows.length
                  }
                  checked={rows.length > 0 && selected.length === rows.length}
                  onChange={(e) =>
                    onSelectAll(
                      e.target.checked,
                      rows.map((r) => r.cluster_id),
                    )
                  }
                />
              </TableCell>
              {columns.map((col) => (
                <TableCell
                  key={col.id}
                  sx={{ width: col.width, minWidth: col.minWidth }}
                >
                  {col.sortable ? (
                    <Stack
                      direction="row"
                      alignItems="center"
                      gap={0.25}
                      sx={{
                        ...focusRing,
                        cursor: "pointer",
                        userSelect: "none",
                        width: "fit-content",
                      }}
                      {...clickable(() => setSortBy(col.id))}
                    >
                      <Typography
                        fontSize={13}
                        fontWeight="fontWeightMedium"
                        color="text.secondary"
                      >
                        {col.label}
                      </Typography>
                      <SortIcon active={sortBy === col.id} dir={sortDir} />
                    </Stack>
                  ) : (
                    <Typography
                      fontSize={13}
                      fontWeight="fontWeightMedium"
                      color="text.secondary"
                    >
                      {col.label}
                    </Typography>
                  )}
                </TableCell>
              ))}
              <TableCell sx={{ width: 40 }} />
            </TableRow>
          </TableHead>

          {/* ── body ── */}
          <TableBody>
            {isLoading ? (
              Array.from({ length: pageSize }).map((_, i) => (
                <SkeletonRow key={i} withAgent={improving} />
              ))
            ) : rows.length === 0 ? (
              <EmptyState filtered={isFiltered} colSpan={columns.length + 2} />
            ) : (
              rows.map((row) => {
                const isSelected = selected.includes(row.cluster_id);
                return (
                  <TableRow
                    key={row.cluster_id}
                    hover
                    selected={isSelected}
                    {...clickable(() => handleRowClick(row.cluster_id), { role: "link" })}
                    role={undefined}
                    sx={{
                      ...focusRing,
                      cursor: "pointer",
                      height: 56,
                      "&.MuiTableRow-hover:hover": { bgcolor: hoverBg },
                      "&.Mui-selected": { bgcolor: selectedBg },
                      "&.Mui-selected:hover": { bgcolor: selectedBg },
                      "& .MuiTableCell-body": {
                        borderBottom: "1px solid",
                        borderColor: "divider",
                        px: 1.5,
                        py: 0,
                      },
                    }}
                  >
                    {/* Checkbox */}
                    <TableCell
                      padding="checkbox"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        size="small"
                        checked={isSelected}
                        onChange={(e) =>
                          onSelect(row.cluster_id, e.target.checked)
                        }
                      />
                    </TableCell>

                    {/* Error name + type */}
                    <TableCell>
                      <Stack
                        direction="column"
                        gap={0.5}
                        justifyContent="center"
                      >
                        <Tooltip
                          title={row.error.name}
                          placement="top-start"
                          arrow
                        >
                          <Typography
                            typography="s2_1"
                            fontWeight="fontWeightMedium"
                            color="text.primary"
                            sx={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              maxWidth: 420,
                              display: "block",
                            }}
                          >
                            {row.error.name}
                          </Typography>
                        </Tooltip>
                        <Stack direction="row" alignItems="center" gap={0.75}>
                          <ErrorTypeTag type={row.error.type} isDark={isDark} />
                          {row.eval_score != null && (
                            <Typography
                              typography="s3"
                              color="text.disabled"
                              sx={{ fontFeatureSettings: "'tnum'" }}
                            >
                              eval: {row.eval_score.toFixed(2)}
                            </Typography>
                          )}
                        </Stack>
                      </Stack>
                    </TableCell>

                    {/* Severity */}
                    <TableCell>
                      <ErrorSeverityBadge severity={row.severity} />
                    </TableCell>

                    {/* Status */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {/* One status: the fix's once there is one, else the issue's own. */}
                      <IssueStatusChip issue={row} />
                    </TableCell>

                    {/* Agent */}
                    {improving && (
                      <TableCell>
                        <IssueAgentCell issue={row} />
                      </TableCell>
                    )}

                    {/* Traces */}
                    <TableCell>
                      <Typography
                        typography="s2_1"
                        fontWeight="fontWeightMedium"
                        color="text.primary"
                        sx={{ fontFeatureSettings: "'tnum'" }}
                      >
                        {fmt(row.trace_count)}
                      </Typography>
                    </TableCell>

                    {/* Users */}
                    <TableCell>
                      <Typography
                        typography="s2_1"
                        color="text.secondary"
                        sx={{ fontFeatureSettings: "'tnum'" }}
                      >
                        {fmt(row.users_affected)}
                      </Typography>
                    </TableCell>

                    {/* Layer */}
                    <TableCell>
                      <FixLayerChip layer={row.fix_layer} />
                    </TableCell>

                    {/* Trend sparkline */}
                    <TableCell sx={{ p: "0 8px !important" }}>
                      <ErrorTrendSparkline
                        data={row.trends}
                        severity={row.severity}
                      />
                    </TableCell>

                    {/* Last seen */}
                    <TableCell>
                      <Typography typography="s3" color="text.disabled" noWrap>
                        {row.lastSeenHuman ?? humanizeTime(row.last_seen)}
                      </Typography>
                    </TableCell>

                    {/* Actions */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Tooltip title="View details" arrow>
                        <IconButton
                          size="small"
                          sx={{
                            opacity: 0,
                            transition: "opacity 0.15s",
                            ".MuiTableRow-root:hover &": { opacity: 1 },
                          }}
                          onClick={() => handleRowClick(row.cluster_id)}
                        >
                          <Iconify icon="mdi:arrow-right" width={16} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* ── Pagination ── */}
      {totalCount > 0 && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ p: 1, py: 1.5, flexShrink: 0 }}
        >
          <Stack gap={1} direction="row" alignItems="center">
            <Typography
              typography="s2"
              color="text.primary"
              fontWeight="fontWeightRegular"
            >
              Results per page
            </Typography>
            <Select
              size="small"
              value={pageSize}
              onChange={(e) => {
                useErrorFeedStore.setState({
                  pageSize: e.target.value,
                  page: 0,
                });
              }}
              sx={{ height: 36, bgcolor: "background.paper" }}
            >
              {[10, 25, 50].map((size) => (
                <MenuItem key={size} value={size}>
                  {size}
                </MenuItem>
              ))}
            </Select>
          </Stack>

          <Pagination
            count={Math.ceil(totalCount / pageSize)}
            variant="outlined"
            shape="rounded"
            page={page + 1}
            color="primary"
            onChange={(_, value) => setPage(value - 1)}
            renderItem={(item) => (
              <PaginationItem
                {...item}
                sx={{ borderRadius: "4px", bgcolor: "background.paper" }}
                slots={{
                  previous: () => (
                    <Box display="flex" alignItems="center" gap={0.5}>
                      <Iconify
                        icon="octicon:chevron-left-24"
                        width={18}
                        height={18}
                        sx={{ path: { strokeWidth: 1.5 } }}
                      />
                      Back
                    </Box>
                  ),
                  next: () => (
                    <Box display="flex" alignItems="center" gap={0.5}>
                      Next
                      <Iconify
                        icon="octicon:chevron-right-24"
                        width={18}
                        height={18}
                        sx={{ path: { strokeWidth: 1.5 } }}
                      />
                    </Box>
                  ),
                }}
              />
            )}
          />
        </Stack>
      )}
    </>
  );
}

ErrorFeedTable.propTypes = {
  selected: PropTypes.arrayOf(PropTypes.string),
  onSelect: PropTypes.func,
  onSelectAll: PropTypes.func,
};
