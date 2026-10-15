import React, { useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import ConfirmDialog from "src/components/custom-dialog/confirm-dialog";
import Iconify from "src/components/iconify";
import { unitWord } from "src/sections/projects/observePopulation";
import {
  analyseErrorMessage,
  analyseKeys,
  deleteConfig,
  patchConfig,
  useAnalyseConfig,
  useAnalyseRun,
} from "./analyseApi";
import { formatCount, formatDay, formatWhen } from "./analyseFormat";
import { useCancellable } from "./analyseHooks";
import { isRunActive, lensFor, unitTitle } from "./analyseLenses";
import { ErrorState } from "./parts";
import ReportBody from "./ReportBody";
import RerunDialog from "./RerunDialog";
import RunProgress from "./RunProgress";

function InfoChip({ label, icon, title }) {
  const chip = (
    <Chip
      size="small"
      variant="outlined"
      icon={icon ? <Iconify icon={icon} width={13} /> : undefined}
      label={label}
      sx={{ height: 24, borderRadius: 0.75, maxWidth: 420 }}
    />
  );
  return title ? (
    <Tooltip describeChild arrow title={title}>
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}

InfoChip.propTypes = {
  label: PropTypes.node.isRequired,
  icon: PropTypes.string,
  title: PropTypes.node,
};

function RunPager({ runs, runId, onSelectRun }) {
  const ordered = runs || [];
  const index = ordered.findIndex((run) => run.id === runId);
  if (index < 0 || ordered.length < 2) return null;
  const older = ordered[index + 1];
  const newer = ordered[index - 1];
  const position = ordered.length - index;
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.25}
      aria-label="Runs of this report"
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        pl: 0.25,
        pr: 0.25,
      }}
    >
      <Tooltip describeChild arrow title={older ? "Older run" : ""}>
        <span>
          <IconButton
            size="small"
            aria-label="Older run"
            disabled={!older}
            onClick={() => onSelectRun(older.id)}
          >
            <Iconify icon="mdi:chevron-left" width={18} />
          </IconButton>
        </span>
      </Tooltip>
      <Typography
        variant="body2"
        sx={{
          px: 0.5,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        Run {position} of {ordered.length} ·{" "}
        {formatWhen(ordered[index].created_at)}
      </Typography>
      <Tooltip describeChild arrow title={newer ? "Newer run" : ""}>
        <span>
          <IconButton
            size="small"
            aria-label="Newer run"
            disabled={!newer}
            onClick={() => onSelectRun(newer.id)}
          >
            <Iconify icon="mdi:chevron-right" width={18} />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
}

RunPager.propTypes = {
  runs: PropTypes.array,
  runId: PropTypes.string,
  onSelectRun: PropTypes.func.isRequired,
};

function ReportName({ config, editing, setEditing }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(config.name);
  const saving = useCancellable("The report could not be renamed.");

  const save = () =>
    saving.run(async () => {
      const name = value.trim();
      if (!name || name === config.name) {
        setEditing(false);
        return null;
      }
      const updated = await patchConfig(config.id, {
        name: name.slice(0, 255),
      });
      queryClient.setQueryData(analyseKeys.config(config.id), updated);
      queryClient.invalidateQueries({ queryKey: ["analyse", "configs"] });
      setEditing(false);
      return updated;
    });

  if (editing)
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
            if (event.key === "Escape") {
              setValue(config.name);
              setEditing(false);
            }
          }}
          inputProps={{ "aria-label": "Report name", maxLength: 255 }}
          disabled={saving.state.status === "busy"}
          error={saving.state.status === "error"}
          helperText={
            saving.state.status === "error" ? saving.state.error : undefined
          }
          sx={{ width: 420 }}
        />
        <Button
          size="small"
          variant="contained"
          onClick={save}
          disabled={saving.state.status === "busy"}
        >
          Save
        </Button>
        <Button
          size="small"
          color="inherit"
          onClick={() => {
            setValue(config.name);
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </Stack>
    );
  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      sx={{ minWidth: 0 }}
    >
      <Typography
        variant="body2"
        color="text.secondary"
        noWrap
        title={config.name}
      >
        {config.name}
      </Typography>
      <Tooltip describeChild arrow title="Rename">
        <IconButton
          size="small"
          aria-label="Rename report"
          onClick={() => {
            setValue(config.name);
            setEditing(true);
          }}
        >
          <Iconify icon="mdi:pencil-outline" width={14} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

ReportName.propTypes = {
  config: PropTypes.object.isRequired,
  editing: PropTypes.bool.isRequired,
  setEditing: PropTypes.func.isRequired,
};

function taxonomyNote(run, config) {
  if (!run || run.status !== "completed") return null;
  if (run.taxonomy_mode === "classify")
    return {
      label: `Using this report's categories from ${formatDay(config?.taxonomy?.frozen_at) || "its first run"}`,
      title:
        "Runs after the first sort into the same categories so their shares can be compared. Rediscover categories (menu) to find new ones.",
    };
  if (config?.taxonomy?.source_run_id === run.id)
    return {
      label: "Categories discovered in this run",
      title:
        "Later runs of this report reuse these categories so their shares compare.",
    };
  return { label: "Categories discovered in this run" };
}

export default function ReportPage({
  projectId,
  configId,
  runId,
  categoryId,
  exampleId,
  onBack,
  onSelectRun,
  onDrawer,
  onDeleted,
  onStarted,
}) {
  const queryClient = useQueryClient();
  const configQuery = useAnalyseConfig(configId);
  const config = configQuery.data;
  const effectiveRunId = runId || config?.latest_run?.id;
  const runQuery = useAnalyseRun(effectiveRunId);
  const run = runQuery.data;
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [rerun, setRerun] = useState(null); // {rediscover}
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const deleting = useCancellable("The report could not be deleted.");

  if (configQuery.isLoading)
    return (
      <Stack spacing={2}>
        <Skeleton variant="text" width={120} />
        <Skeleton variant="text" width="50%" height={36} />
        <Skeleton variant="rounded" height={180} />
        <Skeleton variant="rounded" height={88} />
        <Skeleton variant="rounded" height={320} />
      </Stack>
    );
  if (configQuery.isError || !config)
    return (
      <Stack spacing={2} alignItems="flex-start">
        <Button
          size="small"
          color="inherit"
          onClick={onBack}
          startIcon={<Iconify icon="mdi:chevron-left" width={18} />}
        >
          Reports
        </Button>
        <ErrorState
          message={analyseErrorMessage(
            configQuery.error,
            "This report could not be loaded. It may have been deleted.",
          )}
          onRetry={() => configQuery.refetch()}
        />
      </Stack>
    );

  const lens = lensFor(config.lens);
  const active = isRunActive(run?.status);
  const latest = config.latest_run;
  const newerRunning =
    latest && latest.id !== effectiveRunId && isRunActive(latest.status);
  const note = taxonomyNote(run, config);

  const remove = () =>
    deleting.run(async () => {
      await deleteConfig(config.id);
      queryClient.invalidateQueries({ queryKey: ["analyse", "configs"] });
      queryClient.removeQueries({ queryKey: analyseKeys.config(config.id) });
      setConfirmDelete(false);
      onDeleted();
      return true;
    });

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ minWidth: 0 }}
      >
        <Button
          size="small"
          color="inherit"
          onClick={onBack}
          startIcon={<Iconify icon="mdi:chevron-left" width={18} />}
          sx={{ ml: -0.75, flexShrink: 0 }}
        >
          Reports
        </Button>
        <Typography color="text.disabled">/</Typography>
        <ReportName
          key={`${config.id}-${renaming}`}
          config={config}
          editing={renaming}
          setEditing={setRenaming}
        />
      </Stack>

      <Stack
        direction="row"
        spacing={2}
        alignItems="flex-start"
        justifyContent="space-between"
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="m1"
            component="h1"
            fontWeight={600}
            sx={{ display: "block" }}
          >
            {run?.settings?.question || config.question}
          </Typography>
          <Stack
            direction="row"
            spacing={0.75}
            useFlexGap
            flexWrap="wrap"
            sx={{ mt: 1 }}
          >
            <InfoChip
              label={unitTitle(config.unit)}
              icon="mdi:layers-outline"
            />
            <InfoChip
              label={
                lens.title === "Your question" ? "Custom question" : lens.title
              }
              icon={lens.icon}
            />
            {run?.scope?.label && (
              <InfoChip label={run.scope.label} icon="mdi:calendar-range" />
            )}
            {run && run.sample_size > 0 && (
              <InfoChip
                label={`Sampled ${formatCount(run.sample_size)} of ${formatCount(run.population_size)}`}
                title={`An even sample over time of ${formatCount(run.sample_size)} ${unitWord(run.unit, run.sample_size)} from the ${formatCount(run.population_size)} collected for this run.`}
              />
            )}
            {note && (
              <InfoChip
                label={note.label}
                icon="mdi:shape-outline"
                title={note.title}
              />
            )}
          </Stack>
        </Box>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ flexShrink: 0 }}
        >
          <RunPager
            runs={config.runs}
            runId={effectiveRunId}
            onSelectRun={onSelectRun}
          />
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<Iconify icon="mdi:refresh" width={16} />}
            onClick={() => setRerun({ rediscover: false })}
            disabled={isRunActive(latest?.status)}
          >
            Run again
          </Button>
          <IconButton
            aria-label="More actions"
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            <Iconify icon="mdi:dots-vertical" width={20} />
          </IconButton>
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                setRenaming(true);
              }}
            >
              <ListItemIcon>
                <Iconify icon="mdi:pencil-outline" width={18} />
              </ListItemIcon>
              <ListItemText>Rename</ListItemText>
            </MenuItem>
            <MenuItem
              disabled={!config.has_taxonomy || isRunActive(latest?.status)}
              onClick={() => {
                setMenuAnchor(null);
                setRerun({ rediscover: true });
              }}
            >
              <ListItemIcon>
                <Iconify icon="mdi:shape-plus-outline" width={18} />
              </ListItemIcon>
              <ListItemText
                primary="Rediscover categories"
                secondary="Later runs keep these categories so they compare"
                secondaryTypographyProps={{ variant: "caption" }}
              />
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                setConfirmDelete(true);
              }}
              sx={{ color: "error.main" }}
            >
              <ListItemIcon sx={{ color: "inherit" }}>
                <Iconify icon="mdi:trash-can-outline" width={18} />
              </ListItemIcon>
              <ListItemText>Delete</ListItemText>
            </MenuItem>
          </Menu>
        </Stack>
      </Stack>

      {newerRunning && (
        <Alert
          severity="info"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => onSelectRun(latest.id)}
            >
              View progress
            </Button>
          }
        >
          A newer run of this report is in progress.
        </Alert>
      )}

      {!effectiveRunId ? (
        <Alert
          severity="info"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => setRerun({ rediscover: false })}
            >
              Run it
            </Button>
          }
        >
          This report has not run yet.
        </Alert>
      ) : runQuery.isLoading ? (
        <Stack spacing={2}>
          <Skeleton variant="rounded" height={180} />
          <Skeleton variant="rounded" height={88} />
          <Skeleton variant="rounded" height={320} />
        </Stack>
      ) : runQuery.isError || !run ? (
        <ErrorState
          message={analyseErrorMessage(
            runQuery.error,
            "This run could not be loaded.",
          )}
          onRetry={() => runQuery.refetch()}
        />
      ) : active ? (
        <RunProgress run={run} />
      ) : run.status === "failed" ? (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => setRerun({ rediscover: false })}
            >
              Retry
            </Button>
          }
        >
          <Typography variant="subtitle2">This run failed</Typography>
          {run.error || "Something went wrong while the report was running."}
        </Alert>
      ) : (
        <ReportBody
          projectId={projectId}
          config={config}
          run={run}
          categoryId={categoryId}
          exampleId={exampleId}
          onDrawer={onDrawer}
          onSelectRun={onSelectRun}
        />
      )}

      <RerunDialog
        open={Boolean(rerun)}
        projectId={projectId}
        config={config}
        initialRediscover={rerun?.rediscover}
        onClose={() => setRerun(null)}
        onStarted={(cid, rid) => {
          setRerun(null);
          onStarted(cid, rid);
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this report?"
        content={
          <Stack spacing={1}>
            <Typography variant="body2">
              “{config.name}” and all {formatCount(config.runs?.length || 0)} of
              its runs will be deleted. This can&apos;t be undone.
            </Typography>
            {deleting.state.status === "error" && (
              <Alert severity="error">{deleting.state.error}</Alert>
            )}
          </Stack>
        }
        action={
          <Button
            size="small"
            variant="contained"
            color="error"
            onClick={remove}
            disabled={deleting.state.status === "busy"}
          >
            Delete
          </Button>
        }
      />
    </Stack>
  );
}

ReportPage.propTypes = {
  projectId: PropTypes.string.isRequired,
  configId: PropTypes.string.isRequired,
  runId: PropTypes.string,
  categoryId: PropTypes.string,
  exampleId: PropTypes.string,
  onBack: PropTypes.func.isRequired,
  onSelectRun: PropTypes.func.isRequired,
  onDrawer: PropTypes.func.isRequired,
  onDeleted: PropTypes.func.isRequired,
  onStarted: PropTypes.func.isRequired,
};
