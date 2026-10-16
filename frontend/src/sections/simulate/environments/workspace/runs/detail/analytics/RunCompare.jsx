import { useRef, useState } from "react";
import PropTypes from "prop-types";
import {
  Box,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import {
  useCompareRuns,
  useFinishedRuns,
} from "src/api/simulate-environments/compareRuns";
import {
  COMPARE_COPY as COPY,
  agentDiffersTag,
} from "../../../workspace.constants";
import { ACTIVE_EXECUTION_STATUSES } from "../../runs.constants";
import { COLORS, format, number } from "./DashboardCharts";

// The picker's own entry that reads the next page of older runs.
const LOAD_MORE = "__load-more__";
// The picker's entry that reads the runs again after they failed to load.
const RETRY = "__retry__";
// On a dot beside the verdict only: as text these fail contrast.
const VERDICT_COLORS = {
  improved: COLORS[1],
  regressed: COLORS[2],
  no_meaningful_change: COLORS[5],
  inconclusive: COLORS[3],
};
// What needs a look first: changes, then the unsure, then what can't be judged.
const ORDER = {
  regressed: 0,
  improved: 1,
  inconclusive: 2,
  criteria_changed: 3,
  no_meaningful_change: 4,
  new: 5,
  not_applicable: 6,
};
const tableSx = {
  "& th": { fontSize: 10, textTransform: "uppercase", color: "text.secondary" },
  "& td": { fontSize: 12, verticalAlign: "top" },
  "& tr:last-child td": { borderBottom: 0 },
};

const signed = (value) =>
  value == null ? "-" : `${value > 0 ? "+" : ""}${number(value)}`;

const versionLine = (versions) =>
  Object.entries(COPY.pieces)
    .map(([piece, name]) =>
      versions?.[piece]?.label ? `${name} ${versions[piece].label}` : null,
    )
    .filter(Boolean)
    .join(" · ");

const pickerLabel = (run) =>
  [
    run.label,
    versionLine({
      agent: run.pinnedAgentVersion,
      environment: run.environmentVersion,
      suite: run.suiteVersion,
    }) || COPY.beforeVersioning,
    run.agentDiffers
      ? agentDiffersTag(
          run.pinnedAgentVersion?.label,
          run.environmentVersion?.label,
        )
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

const rank = (pair) =>
  ORDER[pair.band === "paired" ? pair.verdict : pair.band] ?? ORDER.new;

function Side({ side }) {
  if (!side) return "-";
  return (
    <>
      {format(side.pass_rate, "percent")}
      <Typography sx={{ fontSize: 10, color: "text.secondary" }}>
        {COPY.passed(side.passed, side.trials, side.undecided)}
      </Typography>
    </>
  );
}
Side.propTypes = { side: PropTypes.object };

function Verdict({ pair }) {
  const verdict = pair.verdict ? (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Box
        component="span"
        aria-hidden
        sx={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          bgcolor: VERDICT_COLORS[pair.verdict],
        }}
      />
      <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
        {COPY.verdicts[pair.verdict]}
      </Typography>
    </Stack>
  ) : null;
  const interval = pair.interval
    ? COPY.interval(signed(pair.interval.low), signed(pair.interval.high))
    : null;
  let hint = null;
  if (pair.band === "new")
    hint = pair.current ? COPY.newHint : COPY.newInComparedHint;
  if (pair.band === "not_applicable")
    hint =
      COPY.removed(pair.reason, pair.removed_in?.label) ||
      (pair.current ? COPY.notRunInComparedHint : COPY.notApplicableHint);
  if (pair.band === "criteria_changed")
    hint = COPY.criteriaHint(pair.changed_sub_goals);
  return (
    <Stack spacing={0.25} alignItems="flex-start">
      {pair.band !== "paired" && (
        <Chip size="small" label={COPY.bands[pair.band]} />
      )}
      {verdict}
      {[interval, hint].filter(Boolean).map((text) => (
        <Typography key={text} sx={{ fontSize: 10, color: "text.secondary" }}>
          {text}
        </Typography>
      ))}
    </Stack>
  );
}
Verdict.propTypes = { pair: PropTypes.object.isRequired };

export default function RunCompare({ env, executionId, executionStatus }) {
  const [against, setAgainst] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Reading more runs keeps the picker open, and the entry that asked stays in
  // its place once there are no more, so keyboard focus is not lost.
  const keepOpen = useRef(false);
  const [readMore, setReadMore] = useState(false);
  // Only two finished runs compare, so nothing is asked until the run is known
  // to be completed. A run being cancelled will not finish.
  const live =
    ACTIVE_EXECUTION_STATUSES.has(executionStatus) &&
    executionStatus !== "cancelling";
  const finished = executionStatus === "completed";
  // The runs to pick from are read only once the picker opens.
  const {
    runs,
    hasMore,
    loadMore,
    isLoadingMore,
    isLoading: runsLoading,
    isFetched: runsFetched,
    isError: runsError,
    refetch: refetchRuns,
  } = useFinishedRuns(env, { enabled: pickerOpen && finished });
  const { data, isPending, isError } = useCompareRuns(
    env?.id,
    executionId,
    against,
    { enabled: finished },
  );
  // A failed or stopped run has nothing to compare; nor is there anything to
  // add when the comparison can't be read: the dashboard keeps its own change
  // tile.
  if (executionStatus && !live && !finished) return null;
  if (finished && isError && !against) return null;

  const others = runs.filter(
    (run) => run.executionId && run.executionId !== executionId,
  );
  const selected = against || data?.against_execution_id || "";
  const known = others.some((run) => run.executionId === selected);
  const runLabel = (id) =>
    others.find((run) => run.executionId === id)?.label || COPY.previousRun;
  const pairs = [...(data?.pairs ?? [])].sort((a, b) => rank(a) - rank(b));
  const summary = data?.summary;
  const counts = summary
    ? Object.entries(COPY.summary)
        .filter(([key]) => summary[key])
        .map(([key, label]) => `${summary[key]} ${label}`)
    : [];

  let moreLabel = COPY.loadMore;
  if (isLoadingMore) moreLabel = COPY.loadingMore;
  else if (!hasMore) moreLabel = COPY.noOlderRuns;

  // One entry for the state of the list, so focus stays on it as that changes.
  let runsNote = null;
  if (runsLoading) runsNote = COPY.loadingRuns;
  else if (runsError) runsNote = COPY.runsError;
  else if (runsFetched && !others.length && !hasMore)
    runsNote = COPY.noOtherRuns;

  let body;
  if (live) {
    body = (
      <Typography sx={{ mt: 0.75, fontSize: 12, color: "text.secondary" }}>
        {COPY.unfinished}
      </Typography>
    );
  } else if (!finished || isPending) {
    body = (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
        <CircularProgress size={14} />
        <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
          {COPY.loading}
        </Typography>
      </Stack>
    );
  } else if (isError) {
    body = (
      <Typography sx={{ mt: 0.75, fontSize: 12, color: "text.secondary" }}>
        {COPY.error}
      </Typography>
    );
  } else if (!data?.against_execution_id) {
    body = (
      <Typography sx={{ mt: 0.75, fontSize: 12, color: "text.secondary" }}>
        {COPY.nothingBefore}
      </Typography>
    );
  } else {
    body = (
      <>
        <Typography sx={{ mt: 0.75, fontSize: 11, color: "text.secondary" }}>
          {COPY.versions(COPY.thisRun, versionLine(data.versions?.current))}
          {" · "}
          {COPY.versions(
            runLabel(data.against_execution_id),
            versionLine(data.versions?.against),
          )}
        </Typography>
        {counts.length > 0 && (
          <Typography sx={{ mt: 0.5, fontSize: 12 }}>
            {counts.join(" · ")}
          </Typography>
        )}
        <Box sx={{ overflowX: "auto", mt: 1 }}>
          <Table size="small" sx={tableSx}>
            <TableHead>
              <TableRow>
                <TableCell>{COPY.columns.scenario}</TableCell>
                <TableCell align="right">{COPY.columns.current}</TableCell>
                <TableCell align="right">{COPY.columns.against}</TableCell>
                <TableCell align="right">{COPY.columns.change}</TableCell>
                <TableCell>{COPY.columns.verdict}</TableCell>
                <TableCell align="right">{COPY.columns.evals}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pairs.map((pair) => (
                <TableRow key={pair.scenario_key}>
                  <TableCell>{pair.scenario}</TableCell>
                  <TableCell align="right">
                    <Side side={pair.current} />
                  </TableCell>
                  <TableCell align="right">
                    <Side side={pair.against} />
                  </TableCell>
                  <TableCell align="right">
                    {pair.difference == null
                      ? "-"
                      : `${signed(pair.difference)} pts`}
                  </TableCell>
                  <TableCell>
                    <Verdict pair={pair} />
                  </TableCell>
                  <TableCell align="right">
                    {format(pair.current?.eval_pass_rate, "percent")} /{" "}
                    {format(pair.against?.eval_pass_rate, "percent")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </>
    );
  }

  return (
    <Box
      component="section"
      aria-label={COPY.heading}
      sx={{
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        borderRadius: 1.5,
        px: 2,
        py: 1.5,
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        gap={2}
        flexWrap="wrap"
      >
        <Box>
          <Typography component="h2" sx={{ fontSize: 13, fontWeight: 600 }}>
            {COPY.heading}
          </Typography>
          <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
            {COPY.subtitle(summary?.margin ?? 10)}
          </Typography>
        </Box>
        {finished && (
          <TextField
            select
            size="small"
            label={COPY.picker}
            value={selected}
            onChange={(event) => {
              if (event.target.value === LOAD_MORE) {
                keepOpen.current = true;
                setReadMore(true);
                loadMore();
                return;
              }
              if (event.target.value === RETRY) {
                keepOpen.current = true;
                refetchRuns();
                return;
              }
              setAgainst(event.target.value || null);
            }}
            InputLabelProps={{ shrink: true }}
            SelectProps={{
              displayEmpty: true,
              open: pickerOpen,
              onOpen: () => setPickerOpen(true),
              onClose: () => {
                if (!keepOpen.current) setPickerOpen(false);
                keepOpen.current = false;
              },
            }}
            sx={{ minWidth: 180 }}
          >
            {selected && !known && (
              <MenuItem value={selected}>{COPY.previousRun}</MenuItem>
            )}
            {others.map((run) => (
              <MenuItem key={run.executionId} value={run.executionId}>
                {pickerLabel(run)}
              </MenuItem>
            ))}
            {(hasMore || readMore) && (
              <MenuItem value={LOAD_MORE} disabled={isLoadingMore || !hasMore}>
                {moreLabel}
              </MenuItem>
            )}
            {runsNote && (
              <MenuItem value={RETRY} disabled={!runsError}>
                {runsNote}
              </MenuItem>
            )}
          </TextField>
        )}
      </Stack>
      {body}
    </Box>
  );
}
RunCompare.propTypes = {
  env: PropTypes.object,
  executionId: PropTypes.string.isRequired,
  // The run's own lifecycle status, e.g. `running` or `completed`.
  executionStatus: PropTypes.string,
};
