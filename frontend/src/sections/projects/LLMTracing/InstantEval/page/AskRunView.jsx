import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Link,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import Iconify from "src/components/iconify";
import TraceDetailDrawerV2 from "src/components/traceDetail/TraceDetailDrawerV2";
import { getSafeActionErrorMessage } from "src/utils/errorUtils";
import { insightsReportLink } from "src/sections/projects/observeHandoff";
import { ANSWER_TYPES, readOption } from "../instantEvalPayloads";
import { answerText, quoted } from "../instantEvalAnswers";
import { formatWhen, unitMeta } from "../instantEvalUnits";
import { AskBusy, askError } from "../useInstantEval";
import KeepAnswering from "../results/KeepAnswering";
import { AskCrossTab, AskHeatmap, AskPatterns, AskTimeline } from "./viz";
import AskChartBoundary from "./AskChartBoundary";
import AskRowsTable from "./AskRowsTable";
import { runTime, scopeWords, windowLabel } from "./askFormat";
import {
  answerFilter,
  creditWords,
  describeFilter,
  etaWords,
  rateWords,
  sampleEstimate,
  boundWords,
  unansweredBounds,
  UNANSWERED_BOUND_SHARE,
} from "./askFilter";
import { MAX_HANDOVER } from "./askPopulation";
import { downloadRowsCsv, fetchRowIds, useAskRows } from "./useAskRows";
import {
  answerGridLink,
  rowsGridLink,
  sourceViewLink,
  sourceViewTitle,
  userPageLink,
} from "./askLinks";

const TracesDrawer = lazy(() => import("../../../TracesDrawer/TracesDrawer"));

const pulse = keyframes`
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
`;

const CONTENT_WIDTH = 1180;

const LIVE_STATES = new Set(["running", "preparing", "loading"]);
// Paused, or pausing while the answers already being read land.
const PAUSED_STATES = new Set(["paused", "pausing"]);

function StatusLine({ run, unit, creating }) {
  const meta = unitMeta(unit);
  const live = LIVE_STATES.has(run.status);
  const noun = (n) => (n === 1 ? meta.noun : meta.plural);
  const settled = run.answered + run.failed;
  const failedRows =
    run.failed > 0
      ? `${run.failed.toLocaleString()} ${run.failed === 1 ? "row" : "rows"} couldn't be fully answered`
      : null;
  let text;
  if (creating) text = "Saving the question and starting Jev…";
  else if (run.status === "loading") text = "Loading the run…";
  else if (run.status === "preparing")
    text = `Picking the ${run.total.toLocaleString()} ${noun(run.total)} to read…`;
  else if (run.status === "stalled")
    text = `This run stopped before finishing: ${run.answered.toLocaleString()} of ${run.total.toLocaleString()} answered`;
  else if (run.status === "done")
    text = `${run.answered.toLocaleString()}${
      run.answered < run.total ? ` of ${run.total.toLocaleString()}` : ""
    } ${noun(run.total)} answered${runTime(run, " in ")}`;
  else if (run.status === "pausing")
    text = `Pausing… ${(run.summary?.in_flight ?? 0).toLocaleString()} still answering · ${settled.toLocaleString()} of ${run.total.toLocaleString()} read`;
  else if (run.status === "paused")
    text = `Paused · ${settled.toLocaleString()} of ${run.total.toLocaleString()} read`;
  else if (run.status === "running" && run.summary?.waiting_s)
    text = `Waiting for workers… no answer for ${Math.round(
      run.summary.waiting_s / 60,
    )} min · ${settled.toLocaleString()} of ${run.total.toLocaleString()} answered`;
  else if (run.status === "cancelled")
    text = `Cancelled · ${settled.toLocaleString()} of ${run.total.toLocaleString()} read, ${run.notRead.toLocaleString()} not read`;
  else
    text = [
      `Answering ${settled.toLocaleString()} of ${run.total.toLocaleString()}`,
      run.rate ? rateWords(run.rate) : null,
      run.eta ? etaWords(run.eta) : null,
      runTime(run, "running ") || null,
    ]
      .filter(Boolean)
      .join(" · ");
  const progress = run.total ? (settled / run.total) * 100 : 0;
  const finished = !live && !creating && run.status !== "loading";
  const credits =
    finished && run.creditsUsed != null
      ? `${Math.round(run.creditsUsed).toLocaleString()} credits`
      : run.summary?.credits_estimate
        ? creditWords(run.summary.credits_estimate)
        : null;
  return (
    <Stack spacing={0.75} sx={{ width: "100%" }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Box
          aria-hidden
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            flexShrink: 0,
            bgcolor:
              run.status === "error"
                ? "error.main"
                : run.status === "stalled"
                  ? "warning.main"
                  : live || creating
                    ? "info.main"
                    : run.status === "done"
                      ? "success.main"
                      : "text.disabled",
            ...((live || creating) && {
              animation: `${pulse} 1.6s ease-in-out infinite`,
              "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            }),
          }}
        />
        <Typography
          variant="body2"
          aria-live="polite"
          noWrap
          title={[text, failedRows].filter(Boolean).join(" · ")}
          sx={{ fontVariantNumeric: "tabular-nums", minWidth: 0 }}
        >
          {text}
          {failedRows && run.status !== "loading" && (
            <Box component="span" sx={{ color: "error.main" }}>
              {` · ${failedRows}`}
            </Box>
          )}
        </Typography>
      </Stack>
      {(live || creating || PAUSED_STATES.has(run.status)) && (
        <LinearProgress
          variant={
            creating || run.status === "preparing" || !run.total
              ? "indeterminate"
              : "determinate"
          }
          value={progress}
          color={PAUSED_STATES.has(run.status) ? "inherit" : "primary"}
          aria-label="Answers so far"
          sx={{ height: 4, borderRadius: 2 }}
        />
      )}
      {run.createdBy && (
        <Typography variant="caption" color="text.disabled">
          Started by {run.createdBy.name || run.createdBy.email}
          {run.startedAt ? ` · ${formatWhen(run.startedAt)}` : ""}
          {credits ? ` · ${credits}` : ""}
        </Typography>
      )}
    </Stack>
  );
}

StatusLine.propTypes = {
  run: PropTypes.object.isRequired,
  unit: PropTypes.string.isRequired,
  creating: PropTypes.bool,
};

// Pause, resume, cancel and retry the failed rows of a run.
function RunControls({ run, onControl, busy, retryElsewhere }) {
  const live = run.status === "running" || run.status === "preparing";
  const resumable =
    PAUSED_STATES.has(run.status) ||
    run.status === "cancelled" ||
    run.status === "stalled";
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {live && (
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          startIcon={<Iconify icon="mdi:pause" width={16} />}
          onClick={() => onControl("pause")}
        >
          Pause
        </Button>
      )}
      {resumable &&
        (run.pending + run.notRead > 0 || run.status === "stalled") && (
          <Button
            size="small"
            variant="outlined"
            disabled={busy}
            startIcon={<Iconify icon="mdi:play" width={16} />}
            onClick={() => onControl("resume")}
          >
            {run.status === "cancelled" ? "Read the rest" : "Resume"}
          </Button>
        )}
      {(live || PAUSED_STATES.has(run.status)) && (
        <Button
          size="small"
          color="inherit"
          disabled={busy}
          onClick={() => onControl("cancel")}
        >
          Cancel
        </Button>
      )}
      {run.failed > 0 && !live && !retryElsewhere && (
        <Button
          size="small"
          variant="outlined"
          color="error"
          disabled={busy}
          startIcon={<Iconify icon="mdi:refresh" width={16} />}
          onClick={() => onControl("retry_failed")}
        >
          Retry {run.failed.toLocaleString()}{" "}
          {run.failed === 1 ? "row" : "rows"}
        </Button>
      )}
    </Stack>
  );
}

RunControls.propTypes = {
  run: PropTypes.object.isRequired,
  onControl: PropTypes.func.isRequired,
  busy: PropTypes.bool,
  retryElsewhere: PropTypes.bool,
};

// The sample banner carries the retry when the rows Jev couldn't answer
// could move its estimate noticeably.
function bannerRetries(run, question, focusAnswer) {
  if (!run.sample?.is_sample || !(run.failed > 0)) return false;
  const estimate = sampleEstimate(run, question, focusAnswer);
  const bounds = estimate
    ? unansweredBounds(run, question, estimate.labels)
    : null;
  return Boolean(bounds && bounds.share > UNANSWERED_BOUND_SHARE);
}

function SampleBanner({ run, unit, question, focusAnswer, onControl, busy }) {
  const meta = unitMeta(unit);
  const sample = run.sample;
  if (!sample?.is_sample) return null;
  const estimate = sampleEstimate(run, question, focusAnswer);
  const remaining = Math.max(0, sample.population - sample.requested);
  const live = run.status === "running" || run.status === "preparing";
  // Rows Jev couldn't answer: how far they could move the estimate.
  const bounds = estimate
    ? unansweredBounds(run, question, estimate.labels)
    : null;
  const wide = bounds && bounds.share > UNANSWERED_BOUND_SHARE;
  return (
    <Paper
      variant="outlined"
      sx={{
        px: 2,
        py: 1.25,
        borderRadius: 1.5,
        display: "flex",
        alignItems: "flex-start",
        gap: 1.5,
        bgcolor: "background.neutral",
      }}
    >
      <Iconify
        icon="mdi:chart-bell-curve"
        width={20}
        sx={{ color: "text.secondary", flexShrink: 0, mt: 0.25 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* The estimate gets the whole width, so three answers fit one line. */}
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
        >
          {estimate
            ? estimate.parts.map((part, index) => (
                <React.Fragment key={part}>
                  {index > 0 && " · "}
                  {/* Wrap between the answers, never inside one. */}
                  <Box component="span" sx={{ whiteSpace: "nowrap" }}>
                    {part}
                  </Box>
                </React.Fragment>
              ))
            : "A random sample"}
        </Typography>
        {wide && (
          <Stack
            direction="row"
            alignItems="center"
            spacing={1.5}
            useFlexGap
            flexWrap="wrap"
            sx={{ mt: 0.5 }}
          >
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                flex: 1,
                minWidth: 260,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {boundWords(bounds, question)}
            </Typography>
            {run.failed > 0 && (
              <Button
                size="small"
                variant="outlined"
                color="error"
                disabled={busy || live}
                startIcon={<Iconify icon="mdi:refresh" width={16} />}
                onClick={() => onControl("retry_failed")}
              >
                Retry {run.failed.toLocaleString()}{" "}
                {run.failed === 1 ? "row" : "rows"}
              </Button>
            )}
          </Stack>
        )}
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.5}
          useFlexGap
          flexWrap="wrap"
          sx={{ mt: 0.25 }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ flex: 1, minWidth: 260 }}
          >
            {sample.read.toLocaleString()} of{" "}
            {sample.population.toLocaleString()}
            {sample.population_is_lower_bound ? "+" : ""} {meta.plural} read,
            picked at random, so shares are estimates for the whole view (ranges
            are 95% intervals). Counts on the charts are the rows read.
            {bounds && !wide
              ? ` ${bounds.failed.toLocaleString()} couldn't be answered.`
              : ""}
          </Typography>
          {remaining > 0 && (
            <Stack direction="row" spacing={1}>
              {sample.next_size > 0 && sample.next_size < remaining && (
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy || live || !sample.can_extend}
                  title={live ? "When this run finishes" : undefined}
                  onClick={() =>
                    onControl("read_more", { more: sample.next_size })
                  }
                >
                  Read {sample.next_size.toLocaleString()} more
                </Button>
              )}
              <Button
                size="small"
                variant="outlined"
                disabled={busy || live || !sample.can_extend}
                title={live ? "When this run finishes" : undefined}
                onClick={() => onControl("read_more", {})}
              >
                Read all {sample.population.toLocaleString()}
              </Button>
            </Stack>
          )}
        </Stack>
      </Box>
    </Paper>
  );
}

SampleBanner.propTypes = {
  run: PropTypes.object.isRequired,
  unit: PropTypes.string.isRequired,
  question: PropTypes.object,
  focusAnswer: PropTypes.string,
  onControl: PropTypes.func.isRequired,
  busy: PropTypes.bool,
};

function MoreMenu({ questions, onCopyLink }) {
  const [anchor, setAnchor] = useState(null);
  const navigate = useNavigate();
  const close = () => setAnchor(null);
  const editable = questions.filter((question) => question.templateId);
  return (
    <>
      <IconButton
        size="small"
        aria-label="More actions"
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}
      >
        <Iconify icon="mdi:dots-horizontal" width={18} />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {editable.map((question, index) => (
          <MenuItem
            key={question.configId}
            onClick={() => {
              close();
              navigate(`/dashboard/evaluations/${question.templateId}`);
            }}
          >
            <ListItemIcon>
              <Iconify icon="mdi:pencil-outline" width={18} />
            </ListItemIcon>
            <ListItemText>
              Edit evaluator{editable.length > 1 ? ` ${index + 1}` : ""}
            </ListItemText>
          </MenuItem>
        ))}
        <MenuItem
          onClick={() => {
            close();
            onCopyLink();
          }}
        >
          <ListItemIcon>
            <Iconify icon="mdi:link-variant" width={18} />
          </ListItemIcon>
          <ListItemText>Copy link to this run</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

MoreMenu.propTypes = {
  questions: PropTypes.array.isRequired,
  onCopyLink: PropTypes.func.isRequired,
};

function SelectionBar({
  count,
  unit,
  label,
  onFindPatterns,
  gridLink,
  onClear,
}) {
  const meta = unitMeta(unit);
  return (
    <Paper
      elevation={8}
      role="region"
      aria-label="Selected rows"
      sx={{
        position: "sticky",
        bottom: 16,
        zIndex: 2,
        mx: "auto",
        px: 2,
        py: 1.25,
        borderRadius: 1.5,
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        flexWrap: "wrap",
        maxWidth: 880,
      }}
    >
      <Typography
        variant="body2"
        fontWeight={600}
        sx={{ fontVariantNumeric: "tabular-nums" }}
      >
        {count == null
          ? `Counting the ${meta.plural}…`
          : `${count.toLocaleString()} ${count === 1 ? meta.noun : meta.plural}`}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        noWrap
        sx={{ flex: 1, minWidth: 0 }}
        title={label}
      >
        {label}
      </Typography>
      {onFindPatterns && (
        <Button
          size="small"
          variant="contained"
          startIcon={<Iconify icon="mdi:chart-box-outline" width={16} />}
          onClick={onFindPatterns}
        >
          Find patterns
        </Button>
      )}
      {gridLink && (
        <Button
          size="small"
          variant="outlined"
          onClick={gridLink}
          startIcon={<Iconify icon="mdi:filter-outline" width={16} />}
        >
          Show in Traces
        </Button>
      )}
      <Button size="small" onClick={onClear}>
        Clear
      </Button>
    </Paper>
  );
}

SelectionBar.propTypes = {
  count: PropTypes.number,
  unit: PropTypes.string.isRequired,
  label: PropTypes.string,
  onFindPatterns: PropTypes.func,
  gridLink: PropTypes.func,
  onClear: PropTypes.func.isRequired,
};

/**
 * One Instant eval run, full page: the question, where Jev is (with pause,
 * resume, cancel and retry), what a sample estimates for the whole view, the
 * charts drawn from the server's counts, and the rows themselves, paged from
 * the server. Focusing an answer or selecting on a chart sets a filter that
 * narrows the table and the hand-offs, whatever the run's size.
 */
export default function AskRunView({
  projectId,
  run,
  unit,
  scope,
  creating,
  onRunAgain,
  rerunning,
}) {
  const navigate = useNavigate();
  const meta = unitMeta(unit);
  const { questions, records, summary } = run;
  const [focus, setFocus] = useState({ configId: null, answer: null });
  // {filter, label} from a chart, or {ids, label} from a chart that still
  // selects rows by id (it has every row).
  const [selection, setSelection] = useState(null);
  const [opened, setOpened] = useState(null);
  const [copied, setCopied] = useState(false);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [confirmMore, setConfirmMore] = useState(null);
  const [handing, setHanding] = useState(false);

  // Focus the first question once the questions are known.
  const firstConfigId = questions[0]?.configId || null;
  useEffect(() => {
    setFocus((current) =>
      current.configId && questions.some((q) => q.configId === current.configId)
        ? current
        : { configId: firstConfigId, answer: null },
    );
  }, [firstConfigId, questions]);

  const question =
    questions.find((item) => item.configId === focus.configId) || questions[0];
  const live = run.status === "running" || run.status === "preparing";
  const running = live || Boolean(creating);
  const reads = question?.reads || run.reads;
  const metaLine = [
    sourceViewTitle(unit),
    scopeWords(scope?.label) || windowLabel(run.window),
    run.total
      ? `${run.total.toLocaleString()} ${run.total === 1 ? meta.noun : meta.plural}`
      : null,
    reads && `Jev reads ${readOption(unit, reads).label.toLowerCase()}`,
  ].filter(Boolean);

  // What the table and the hand-offs read: a chart's selection, then the
  // answer in focus on the legend, then every row.
  const idSelection = selection?.ids ? selection : null;
  const filter = idSelection
    ? null
    : selection?.filter ||
      answerFilter(focus.answer ? focus.configId : null, focus.answer);
  const filterLabel = selection
    ? selection.label || describeFilter(selection.filter, questions)
    : focus.answer && question
      ? `${answerText(focus.answer)} · ${question.question}`
      : null;
  const clearFilter = () => {
    setSelection(null);
    setFocus((current) => ({ ...current, answer: null }));
  };

  // Rows read from the server; while a run is live they are read again as
  // answers land.
  const version = live ? run.answered + run.failed : "done";
  const rows = useAskRows({
    projectId,
    taskId: run.taskId,
    unit,
    tz: run.tz,
    filter,
    version,
    enabled: Boolean(summary) && !idSelection,
  });
  const selectedRecords = useMemo(() => {
    if (!idSelection || !records) return null;
    const ids = new Set(idSelection.ids);
    return records.filter((record) => ids.has(record.id));
  }, [idSelection, records]);
  const tableRows = selectedRecords || rows.rows;
  const tableTotal = selectedRecords ? selectedRecords.length : rows.total;

  const openRow = (id) => {
    const record =
      tableRows.find((item) => item.id === id) ||
      (records || []).find((item) => item.id === id);
    if (!record) return;
    if (unit === "users") {
      const userId = record.user_id || record.label;
      if (userId) navigate(userPageLink(userId));
      return;
    }
    setOpened(record);
  };

  const control = async (action, options = {}) => {
    setActing(true);
    setActionError(null);
    try {
      await run.control(action, options);
      setConfirmMore(null);
    } catch (error) {
      const known = askError(error);
      if (known.name === "AskNeedsConfirm")
        setConfirmMore({
          ...options,
          rows: known.rows,
          credits: known.credits,
        });
      else
        setActionError(
          known instanceof AskBusy
            ? known.message
            : getSafeActionErrorMessage(error, "That didn't work. Try again."),
        );
    } finally {
      setActing(false);
    }
  };

  // The rows a hand-off names: ids up to 5,000, else the run's own view.
  const handOverRows = async () => {
    if (selectedRecords) return { rows: selectedRecords };
    if ((tableTotal ?? 0) <= MAX_HANDOVER)
      return {
        rows: await fetchRowIds({
          projectId,
          taskId: run.taskId,
          tz: run.tz,
          filter,
          limit: MAX_HANDOVER,
          unit,
        }),
      };
    return { filters: summary?.scope?.filters || scope?.filters || [] };
  };

  const findPatterns =
    unit === "spans" || !tableTotal || !question
      ? null
      : async () => {
          setHanding(true);
          try {
            const handed = await handOverRows();
            const count = handed.rows ? handed.rows.length : tableTotal;
            const noun = count === 1 ? meta.noun : meta.plural;
            const subject = count === 1 ? `this ${noun}` : `these ${noun}`;
            navigate(
              insightsReportLink(projectId, {
                unit,
                ...(handed.rows
                  ? {
                      population: handed.rows.map((record) => ({
                        id: record.id,
                        time: record.time || "",
                        user_id: record.user_id || "",
                      })),
                    }
                  : { filters: handed.filters }),
                question: focus.answer
                  ? `Why did ${subject} get ${quoted(answerText(focus.answer))} for ${quoted(question.question)}?`
                  : `What do ${subject} have in common?`,
                label: filterLabel || question.question,
                source: `Instant eval: ${question.question}`,
              }),
            );
          } catch (error) {
            setActionError(
              getSafeActionErrorMessage(error, "The rows couldn't be read."),
            );
          } finally {
            setHanding(false);
          }
        };

  const showSelectionInTraces =
    unit === "users"
      ? null
      : async () => {
          const handed = await handOverRows();
          const link = handed.rows
            ? rowsGridLink(projectId, unit, handed.rows)
            : sourceViewLink(projectId, unit);
          if (link) navigate(link);
        };

  const copyLink = () => {
    try {
      globalThis.navigator?.clipboard?.writeText(globalThis.location.href);
      setCopied(true);
    } catch {
      // Copying is a convenience; the address bar has the link.
    }
  };

  const showInTraces =
    unit === "traces" && question && focus.answer
      ? answerGridLink({
          projectId,
          question,
          answer: focus.answer,
          window: run.window,
        })
      : null;

  // Charts: the server's counts always; every row as well when there are
  // few enough to draw one square each.
  const onSelect = (selected, label) => {
    if (Array.isArray(selected)) setSelection({ ids: selected, label });
    else if (selected) setSelection({ filter: selected, label });
    else setSelection(null);
  };
  const chartProps = {
    summary,
    records: records || undefined,
    questions,
    focus,
    onFocus: (next) => {
      setFocus(next);
      setSelection(null);
    },
    onSelect,
    onOpen: openRow,
    running,
    window: run.window,
    unit,
  };

  const exportCsv = async () => {
    try {
      await downloadRowsCsv({
        projectId,
        taskId: run.taskId,
        tz: run.tz,
        filter,
        name: `instant-eval-${(question?.question || "answers")
          .slice(0, 40)
          .replace(/[^\w]+/g, "-")}.csv`,
      });
    } catch (error) {
      setActionError(getSafeActionErrorMessage(error, "The export failed."));
    }
  };

  return (
    <Box sx={{ px: 3, pt: 2.5, pb: 4, maxWidth: CONTENT_WIDTH, mx: "auto" }}>
      <Stack spacing={2.5}>
        <Box>
          <Link
            component={RouterLink}
            to={sourceViewLink(projectId, unit)}
            underline="hover"
            color="text.secondary"
            variant="body2"
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
          >
            <Iconify icon="mdi:arrow-left" width={16} />
            {sourceViewTitle(unit)}
          </Link>
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="flex-start"
            flexWrap="wrap"
            useFlexGap
            sx={{ mt: 1 }}
          >
            <Box
              sx={{
                flex: "1 1 360px",
                minWidth: 0,
                display: "flex",
                alignItems: "flex-start",
                gap: 1.25,
              }}
            >
              <Typography
                variant="h4"
                component="h1"
                title={question?.fullQuestion || undefined}
                sx={{ fontSize: 22, lineHeight: "30px", fontWeight: 600 }}
              >
                {question?.question || <Skeleton variant="text" width={420} />}
              </Typography>
              {question && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={
                    question.answerType === ANSWER_TYPES.CATEGORY
                      ? `${question.labels.length} categories`
                      : "Yes / No"
                  }
                  sx={{ mt: 0.5, flexShrink: 0 }}
                />
              )}
            </Box>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
              sx={{ pt: 0.25 }}
            >
              {!creating && run.summary && (
                <RunControls
                  run={run}
                  onControl={control}
                  busy={acting}
                  retryElsewhere={bannerRetries(
                    run,
                    question,
                    focus.configId === question?.configId ? focus.answer : null,
                  )}
                />
              )}
              {onRunAgain && run.status === "done" && (
                <Button
                  size="small"
                  variant="outlined"
                  disabled={rerunning}
                  startIcon={<Iconify icon="mdi:refresh" width={16} />}
                  onClick={onRunAgain}
                >
                  {rerunning ? "Starting…" : "Run again"}
                </Button>
              )}
              {showInTraces && (
                <Button
                  size="small"
                  variant="outlined"
                  component={RouterLink}
                  to={showInTraces}
                  startIcon={<Iconify icon="mdi:filter-outline" width={16} />}
                >
                  Show in Traces
                </Button>
              )}
              {(unit === "traces" || unit === "spans") &&
                scope?.filters &&
                run.status === "done" && (
                  <KeepAnswering
                    projectId={projectId}
                    run={{ items: questions, scopeFilters: scope.filters }}
                    navigate={navigate}
                    unit={unit}
                  />
                )}
              <MoreMenu questions={questions} onCopyLink={copyLink} />
            </Stack>
          </Stack>
          {questions.length > 1 && (
            <Stack
              direction="row"
              gap={0.75}
              flexWrap="wrap"
              sx={{ mt: 1 }}
              role="tablist"
              aria-label="Questions"
            >
              {questions.map((item, index) => (
                <Chip
                  key={item.configId || index}
                  role="tab"
                  aria-selected={item.configId === question?.configId}
                  size="small"
                  label={`${index + 1} · ${item.question}`}
                  title={item.fullQuestion || item.question}
                  color={
                    item.configId === question?.configId ? "primary" : "default"
                  }
                  variant={
                    item.configId === question?.configId ? "filled" : "outlined"
                  }
                  onClick={() => {
                    setFocus({ configId: item.configId, answer: null });
                    setSelection(null);
                  }}
                  sx={{ maxWidth: 420 }}
                />
              ))}
            </Stack>
          )}
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5, fontSize: 13, fontVariantNumeric: "tabular-nums" }}
          >
            {metaLine.join(" · ")}
          </Typography>
        </Box>

        <StatusLine run={run} unit={unit} creating={creating} />
        {copied && (
          <Alert severity="success" onClose={() => setCopied(false)}>
            Link copied. It opens this run with its answers.
          </Alert>
        )}
        {actionError && (
          <Alert severity="error" onClose={() => setActionError(null)}>
            {actionError}
          </Alert>
        )}
        {confirmMore && (
          <Alert
            severity="warning"
            action={
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => setConfirmMore(null)}>
                  Back
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="warning"
                  disabled={acting}
                  onClick={() =>
                    control("read_more", {
                      ...(confirmMore.more ? { more: confirmMore.more } : {}),
                      confirm: true,
                    })
                  }
                >
                  Start
                </Button>
              </Stack>
            }
          >
            Read {Number(confirmMore.rows || 0).toLocaleString()} more{" "}
            {meta.plural}? That is {creditWords(confirmMore.credits)}.
          </Alert>
        )}

        <SampleBanner
          run={run}
          unit={unit}
          question={question}
          focusAnswer={
            focus.configId === question?.configId ? focus.answer : null
          }
          onControl={control}
          busy={acting}
        />

        {run.status === "error" ? (
          <Alert
            severity="error"
            action={
              <Button size="small" onClick={run.refetch}>
                Retry
              </Button>
            }
          >
            This run couldn&apos;t be loaded. It may have been deleted, or the
            connection dropped.
          </Alert>
        ) : (
          <>
            <AskChartBoundary name="Timeline" resetKey={summary}>
              <AskTimeline {...chartProps} />
            </AskChartBoundary>
            <AskChartBoundary name="Patterns" resetKey={summary}>
              <AskPatterns {...chartProps} />
            </AskChartBoundary>
            {questions.length > 1 && (
              <AskChartBoundary name="Cross-question view" resetKey={summary}>
                <AskCrossTab {...chartProps} />
              </AskChartBoundary>
            )}
            <AskChartBoundary name="Heatmap" resetKey={summary}>
              <AskHeatmap {...chartProps} />
            </AskChartBoundary>
            <AskRowsTable
              records={tableRows}
              questions={questions}
              unit={unit}
              onOpen={openRow}
              filterLabel={filterLabel}
              onClearFilter={clearFilter}
              total={tableTotal}
              runTotal={run.total}
              loading={!selectedRecords && rows.isLoading}
              hasMore={!selectedRecords && rows.hasMore}
              loadingMore={rows.isFetchingMore}
              onLoadMore={rows.loadMore}
              onExport={run.taskId ? exportCsv : undefined}
            />
          </>
        )}

        {filterLabel && (tableTotal ?? 1) > 0 && (
          <SelectionBar
            count={tableTotal}
            unit={unit}
            label={handing ? "Reading the rows…" : filterLabel}
            onFindPatterns={findPatterns}
            gridLink={showSelectionInTraces}
            onClear={clearFilter}
          />
        )}
      </Stack>

      {opened && unit === "sessions" && (
        <Suspense fallback={null}>
          <TracesDrawer
            key={opened.id}
            open
            onClose={() => setOpened(null)}
            rowData={{ session_id: opened.id }}
          />
        </Suspense>
      )}
      {opened && (unit === "traces" || unit === "spans") && (
        <TraceDetailDrawerV2
          open
          onClose={() => setOpened(null)}
          projectId={projectId}
          traceId={unit === "spans" ? opened.trace_id : opened.id}
          initialSpanId={unit === "spans" ? opened.id : undefined}
        />
      )}
    </Box>
  );
}

AskRunView.propTypes = {
  projectId: PropTypes.string.isRequired,
  run: PropTypes.object.isRequired,
  unit: PropTypes.oneOf(["traces", "spans", "sessions", "users"]).isRequired,
  scope: PropTypes.shape({
    label: PropTypes.string,
    filters: PropTypes.array,
  }),
  creating: PropTypes.bool,
  onRunAgain: PropTypes.func,
  rerunning: PropTypes.bool,
};
