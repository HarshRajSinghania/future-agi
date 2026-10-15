import React from "react";
import PropTypes from "prop-types";
import {
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router";
import Iconify from "src/components/iconify";
import { UNITS } from "src/sections/projects/observePopulation";
import { useRunUnit } from "./insightsApi";
import {
  formatCost,
  formatCount,
  formatLatency,
  formatSpan,
  formatWhen,
} from "./insightsFormat";
import { unitLink } from "./insightsLinks";
import { AttributePills, ErrorState, FacetChips, Stat, Swatch } from "./parts";

function Metrics({ metrics, unit }) {
  const items = [
    unit === "users" &&
      Number.isFinite(metrics.sessions) && {
        label: "Sessions",
        value: formatCount(metrics.sessions),
      },
    unit === "users" &&
      Number.isFinite(metrics.active_days) && {
        label: "Active days",
        value: formatCount(metrics.active_days),
      },
    Number.isFinite(metrics.traces) &&
      unit !== "traces" && {
        label: "Traces",
        value: formatCount(metrics.traces),
      },
    Number.isFinite(metrics.turns) && {
      label: "Turns",
      value: formatCount(metrics.turns),
    },
    Number.isFinite(metrics.latency_ms) && {
      label: "Median latency",
      value: formatLatency(metrics.latency_ms),
    },
    Number.isFinite(metrics.duration_s) && {
      label: "Duration",
      value: formatSpan(metrics.duration_s),
    },
    Number.isFinite(metrics.errors) && {
      label: "Errors",
      value: formatCount(metrics.errors),
    },
    metrics.cost > 0 && { label: "Cost", value: formatCost(metrics.cost) },
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 1.5,
      }}
    >
      {items.map((item) => (
        <Stat key={item.label} label={item.label} value={item.value} />
      ))}
    </Box>
  );
}

Metrics.propTypes = { metrics: PropTypes.object, unit: PropTypes.string };

/**
 * One analysed unit: what the model read and concluded, its numbers, and a
 * link to the unit itself. `row` is used when the caller already has it;
 * otherwise it is fetched by id (from a citation).
 */
export default function UnitDrawer({
  open,
  onClose,
  projectId,
  runId,
  unit,
  unitId,
  row,
  categoriesById,
  colorOf,
  onCategory,
}) {
  const navigate = useNavigate();
  const fetched = useRunUnit(runId, row ? null : unitId);
  const data = row || fetched.data;
  const noun = (UNITS[unit] || UNITS.traces).noun;
  const link = unitLink(projectId, unit, data);
  const sub = data && categoriesById.get(data.sub_category_id);
  const top = data && categoriesById.get(data.category_id);
  const facets = data?.facets || {};

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: 520, maxWidth: "100vw" } }}
    >
      <Stack sx={{ height: "100%" }}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
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
            Example {noun}
          </Typography>
          <IconButton aria-label="Close example" onClick={onClose} size="small">
            <Iconify icon="mdi:close" width={18} />
          </IconButton>
        </Stack>
        <Box sx={{ flex: 1, overflowY: "auto", px: 2.5, py: 2 }}>
          {!data && fetched.isLoading ? (
            <Stack spacing={1.5}>
              <Skeleton variant="text" width="70%" height={28} />
              <Skeleton variant="rounded" height={96} />
              <Skeleton variant="rounded" height={64} />
            </Stack>
          ) : !data ? (
            fetched.isError ? (
              <ErrorState
                message="This example could not be loaded."
                onRetry={() => fetched.refetch()}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                This example is no longer part of the report&apos;s categories.
              </Typography>
            )
          ) : (
            <Stack spacing={2.25}>
              <Box>
                <Typography
                  variant="subtitle1"
                  sx={{ wordBreak: "break-word" }}
                >
                  {data.label || data.unit_id}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {[
                    formatWhen(data.time),
                    data.user_id && `user ${data.user_id}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography>
              </Box>
              {(top || sub) && (
                <Stack
                  direction="row"
                  spacing={0.75}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                >
                  {[top, sub].filter(Boolean).map((category, index) => (
                    <React.Fragment key={category.id}>
                      {index > 0 && (
                        <Iconify
                          icon="mdi:chevron-right"
                          width={14}
                          sx={{ color: "text.disabled" }}
                        />
                      )}
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() => onCategory(category.id)}
                        startIcon={<Swatch color={colorOf(top?.id)} size={8} />}
                        sx={{ px: 0.75, minWidth: 0, fontWeight: 500 }}
                      >
                        {category.name}
                      </Button>
                    </React.Fragment>
                  ))}
                </Stack>
              )}
              {data.summary && (
                <Box>
                  <Typography variant="overline" color="text.secondary">
                    Summary
                  </Typography>
                  <Typography variant="body2">{data.summary}</Typography>
                </Box>
              )}
              {data.lens_answer && data.lens_answer !== data.summary && (
                <Box>
                  <Typography variant="overline" color="text.secondary">
                    Answer to the report&apos;s question
                  </Typography>
                  <Typography variant="body2">{data.lens_answer}</Typography>
                </Box>
              )}
              {facets.topic && (
                <Typography variant="body2" color="text.secondary">
                  Topic: {facets.topic}
                </Typography>
              )}
              <FacetChips facets={facets} />
              <AttributePills attributes={facets.attributes} />
              <Divider />
              <Metrics metrics={data.metrics || {}} unit={unit} />
              {data.excerpt && (
                <Box>
                  <Typography variant="overline" color="text.secondary">
                    {unit === "traces" ? "Input" : "First message"}
                  </Typography>
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      borderRadius: 1,
                      bgcolor: "background.neutral",
                      maxHeight: 220,
                      overflowY: "auto",
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                    >
                      {data.excerpt}
                    </Typography>
                  </Paper>
                </Box>
              )}
            </Stack>
          )}
        </Box>
        {link && (
          <Stack
            direction="row"
            justifyContent="flex-end"
            sx={{
              px: 2.5,
              py: 1.5,
              borderTop: "1px solid",
              borderColor: "divider",
            }}
          >
            <Button
              variant="contained"
              endIcon={<Iconify icon="mdi:arrow-top-right" width={16} />}
              onClick={() => navigate(link.href)}
            >
              {link.label}
            </Button>
          </Stack>
        )}
      </Stack>
    </Drawer>
  );
}

UnitDrawer.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  projectId: PropTypes.string.isRequired,
  runId: PropTypes.string,
  unit: PropTypes.string,
  unitId: PropTypes.string,
  row: PropTypes.object,
  categoriesById: PropTypes.instanceOf(Map).isRequired,
  colorOf: PropTypes.func.isRequired,
  onCategory: PropTypes.func.isRequired,
};
