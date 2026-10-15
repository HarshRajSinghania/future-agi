import React, { useMemo } from "react";
import PropTypes from "prop-types";
import {
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { unitWord } from "src/sections/projects/observePopulation";
import { insightsErrorMessage, useInsightsConfigs } from "./insightsApi";
import { buildColorOrder, buildSegments, runTops } from "./insightsDistribution";
import { formatCount, relativeTime } from "./insightsFormat";
import {
  STAGES,
  TEMPLATES,
  isRunActive,
  lensFor,
  unitTitle,
} from "./insightsLenses";
import { ErrorState, Legend, StackedBar } from "./parts";

function lastRunLine(config) {
  const run = config.latest_run;
  if (!run) return { text: "Not run yet" };
  if (isRunActive(run.status)) {
    const stage = STAGES.find((s) => s.key === run.stage);
    return {
      text: `Running · ${stage?.label || "Queued"}`,
      active: true,
    };
  }
  if (run.status === "failed")
    return {
      text: `Last run failed ${relativeTime(run.created_at)}`,
      failed: true,
    };
  return {
    // Analysed counts only what the lens kept (a failures report leaves out
    // conversations with no failure), so show it against what was read.
    text: `Last run ${relativeTime(run.finished_at || run.created_at)} · ${formatCount(
      run.analysed_count ?? run.sample_size,
    )} of ${formatCount(run.sample_size)} ${unitWord(config.unit, run.sample_size)} analysed`,
  };
}

function ReportCard({ config, onOpen, onRerun }) {
  const theme = useTheme();
  const mode = theme.palette.mode;
  const lens = lensFor(config.lens);
  const status = lastRunLine(config);
  const segments = useMemo(() => {
    const run = config.latest_run;
    if (run?.status !== "completed") return [];
    const order = buildColorOrder({
      taxonomy: config.taxonomy,
      runs: [run],
    });
    return buildSegments(runTops(run), { order, mode, max: 5 });
  }, [config, mode]);

  const open = () => onOpen(config.id);
  return (
    <Paper
      variant="outlined"
      role="link"
      tabIndex={0}
      aria-label={`Open report ${config.name}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget)
          open();
      }}
      sx={{
        p: 2,
        borderRadius: 1.5,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 1.25,
        minWidth: 0,
        transition: "border-color 120ms, box-shadow 120ms",
        "&:hover": { borderColor: "text.disabled" },
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: 2,
        },
      }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Chip
          size="small"
          label={unitTitle(config.unit)}
          sx={{ height: 20, fontSize: 11, borderRadius: 0.75 }}
        />
        <Chip
          size="small"
          variant="outlined"
          icon={<Iconify icon={lens.icon} width={12} />}
          label={lens.title === "Your question" ? "Custom" : lens.title}
          sx={{ height: 20, fontSize: 11, borderRadius: 0.75 }}
        />
      </Stack>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" noWrap title={config.name}>
          {config.name}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: 44,
          }}
        >
          {config.question}
        </Typography>
      </Box>
      {segments.length > 0 ? (
        <Stack spacing={1}>
          <StackedBar segments={segments} height={8} />
          <Legend segments={segments} dense />
        </Stack>
      ) : status.active ? (
        <LinearProgress sx={{ borderRadius: 1 }} />
      ) : (
        <Box sx={{ height: 8, borderRadius: "3px", bgcolor: "action.hover" }} />
      )}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ mt: "auto", pt: 0.5 }}
      >
        <Typography
          variant="caption"
          color={status.failed ? "error.main" : "text.secondary"}
          noWrap
        >
          {status.text}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
          {!isRunActive(config.latest_run?.status) && (
            <Button
              size="small"
              color="inherit"
              onClick={(event) => {
                event.stopPropagation();
                onRerun(config);
              }}
              startIcon={<Iconify icon="mdi:refresh" width={14} />}
            >
              Run again
            </Button>
          )}
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            onClick={(event) => {
              event.stopPropagation();
              open();
            }}
          >
            Open
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

ReportCard.propTypes = {
  config: PropTypes.object.isRequired,
  onOpen: PropTypes.func.isRequired,
  onRerun: PropTypes.func.isRequired,
};

function Templates({ onNew, compact }) {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 1.5,
        gridTemplateColumns: compact
          ? "repeat(auto-fill, minmax(220px, 1fr))"
          : "repeat(auto-fill, minmax(240px, 1fr))",
      }}
    >
      {TEMPLATES.map((template) => (
        <Paper
          key={template.lens}
          variant="outlined"
          component="button"
          type="button"
          onClick={() => onNew(template.lens)}
          sx={{
            p: compact ? 1.5 : 2,
            borderRadius: 1.5,
            textAlign: "left",
            font: "inherit",
            color: "text.primary",
            bgcolor: "background.paper",
            cursor: "pointer",
            display: "flex",
            gap: 1.5,
            alignItems: "flex-start",
            "&:hover": { borderColor: "text.disabled" },
            "&:focus-visible": {
              outline: "2px solid",
              outlineColor: "primary.main",
              outlineOffset: 2,
            },
          }}
        >
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: 1,
              bgcolor: "background.neutral",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <Iconify icon={template.icon} width={18} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2">{template.title}</Typography>
            {!compact && (
              <Typography variant="caption" color="text.secondary">
                {template.description}
                {template.unit === "users" ? " Reads whole users." : ""}
              </Typography>
            )}
          </Box>
        </Paper>
      ))}
    </Box>
  );
}

Templates.propTypes = {
  onNew: PropTypes.func.isRequired,
  compact: PropTypes.bool,
};

export default function ReportsHome({ projectId, onNew, onOpen, onRerun }) {
  const configsQuery = useInsightsConfigs(projectId);
  const configs = configsQuery.data || [];

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        spacing={2}
      >
        <Box>
          <Typography variant="m2" component="h1" fontWeight={600}>
            Insights
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Find the topics, failures and kinds of users in your traffic, with
            numbers you can trace back to examples.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Iconify icon="mdi:plus" width={16} />}
          onClick={() => onNew()}
          sx={{ flexShrink: 0 }}
        >
          New report
        </Button>
      </Stack>

      {configsQuery.isLoading ? (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))",
          }}
        >
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rounded" height={196} />
          ))}
        </Box>
      ) : configsQuery.isError ? (
        <ErrorState
          message={insightsErrorMessage(
            configsQuery.error,
            "Reports could not be loaded.",
          )}
          onRetry={() => configsQuery.refetch()}
        />
      ) : configs.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 1.5 }}>
          <Typography variant="subtitle1" component="h2">
            Start with a question
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 2.5, maxWidth: 720 }}
          >
            A report reads a sample of your traces, sessions or users,
            summarises each one, groups them into categories and measures each
            category: how many, how many users, how often they fail, and what
            sets them apart. Every number links back to the examples behind it.
          </Typography>
          <Templates onNew={onNew} />
        </Paper>
      ) : (
        <>
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))",
            }}
          >
            {configs.map((config) => (
              <ReportCard
                key={config.id}
                config={config}
                onOpen={onOpen}
                onRerun={onRerun}
              />
            ))}
          </Box>
          <Box>
            <Typography
              variant="overline"
              color="text.secondary"
              component="h2"
              sx={{ display: "block", mb: 1 }}
            >
              Start from a template
            </Typography>
            <Templates onNew={onNew} compact />
          </Box>
        </>
      )}
    </Stack>
  );
}

ReportsHome.propTypes = {
  projectId: PropTypes.string.isRequired,
  onNew: PropTypes.func.isRequired,
  onOpen: PropTypes.func.isRequired,
  onRerun: PropTypes.func.isRequired,
};
