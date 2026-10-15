import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  InputAdornment,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, keyframes, useTheme } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { unitWord } from "src/sections/projects/observePopulation";
import { isLiveRun, useInstantEvalHistory } from "./useInstantEval";
import { answerText, summarizeCounts } from "./instantEvalAnswers";
import { formatAgo, formatWhen, unitMeta } from "./instantEvalUnits";
import { readOption } from "./instantEvalPayloads";
import { answerColor, distributionEntries } from "./results/answerColors";

const pulse = keyframes`
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
`;

const STATUS = {
  completed: { label: "Completed", color: "success.main" },
  running: { label: "Running", color: "info.main", live: true },
  pending: { label: "Queued", color: "info.main", live: true },
  failed: { label: "Failed", color: "error.main" },
  paused: { label: "Paused", color: "warning.main" },
  deleted: { label: "Deleted", color: "text.disabled" },
};

const percent = (share) => `${Math.round(share * 100)}%`;

// The first question's answers as a thin bar, with the split as text.
function SplitBar({ item, summary }) {
  const theme = useTheme();
  const entries = distributionEntries(summary).filter((e) => e.count > 0);
  const text = entries
    .map((entry) => `${answerText(entry.answer)} ${entry.count}`)
    .join(" · ");
  const top = entries
    .filter((entry) => !entry.muted)
    .sort((a, b) => b.count - a.count)[0];
  return (
    <Tooltip title={`${item.question} — ${text}`} placement="left">
      <Box sx={{ width: 112 }}>
        <Box
          aria-label={`Answers: ${text}`}
          role="img"
          sx={{
            display: "flex",
            height: 6,
            borderRadius: 3,
            overflow: "hidden",
            bgcolor: alpha(theme.palette.text.disabled, 0.15),
          }}
        >
          {entries.map((entry) => (
            <Box
              key={entry.answer}
              sx={{
                width: `${entry.share * 100}%`,
                bgcolor: answerColor(item, entry.answer, theme),
              }}
            />
          ))}
        </Box>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          component="p"
          sx={{ mt: 0.5, textAlign: "right" }}
        >
          {top ? `${top.label} ${percent(top.share)}` : "No answers"}
        </Typography>
      </Box>
    </Tooltip>
  );
}

SplitBar.propTypes = {
  item: PropTypes.object.isRequired,
  summary: PropTypes.object.isRequired,
};

// "50 sessions"; a user question counts the sessions it read. Runs still
// being answered say how far they are.
function coverageText(runItem) {
  const noun = runItem.unit === "users" ? "sessions" : runItem.unit;
  const rows = runItem.rows;
  if (rows == null) return "";
  const count = `${rows.toLocaleString()} ${unitWord(noun, rows)}`;
  return isLiveRun(runItem)
    ? `${Math.min(runItem.answered, rows).toLocaleString()} of ${count} answered`
    : count;
}

const SEARCH_DEBOUNCE_MS = 250;

function HistoryRow({ runItem, onOpen }) {
  const item = runItem.items[0];
  const summary = item
    ? summarizeCounts(runItem.counts[item.configId], item)
    : null;
  const status = STATUS[runItem.status] || {
    label: runItem.status || "",
    color: "text.disabled",
  };
  const reads = item?.reads || runItem.reads;
  const meta = [
    coverageText(runItem),
    reads && readOption(runItem.unit, reads).label,
    formatAgo(runItem.createdAt),
    status.label,
  ].filter(Boolean);
  const open = () => onOpen(runItem);
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={`Open the run: ${item?.question}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 1.25,
        px: 1.5,
        py: 1.25,
        cursor: "pointer",
        borderBottom: "1px solid",
        borderColor: "divider",
        "&:last-of-type": { borderBottom: "none" },
        "&:hover": { bgcolor: "action.hover" },
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: -2,
        },
      }}
    >
      <Box
        title={status.label}
        sx={{
          width: 8,
          height: 8,
          mt: 0.75,
          borderRadius: "50%",
          flexShrink: 0,
          bgcolor: status.color,
          ...(status.live && {
            animation: `${pulse} 1.6s ease-in-out infinite`,
          }),
        }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="body2"
          fontWeight={600}
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "break-word",
          }}
        >
          {item?.question}
        </Typography>
        {runItem.items.length > 1 && (
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            component="p"
            title={runItem.items
              .slice(1)
              .map((entry) => entry.question)
              .join("\n")}
          >
            +{" "}
            {runItem.items
              .slice(1)
              .map((entry) => entry.question)
              .join(" · ")}
          </Typography>
        )}
        <Typography
          variant="caption"
          color="text.disabled"
          noWrap
          component="p"
          title={formatWhen(runItem.createdAt)}
          sx={{ mt: 0.25 }}
        >
          {meta.join(" · ")}
        </Typography>
      </Box>
      <Box sx={{ flexShrink: 0, pt: 0.5 }}>
        {summary && summary.total > 0 ? (
          <SplitBar item={item} summary={summary} />
        ) : (
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ display: "block", width: 112, textAlign: "right" }}
          >
            {isLiveRun(runItem) ? "Reading…" : "No answers"}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

HistoryRow.propTypes = {
  runItem: PropTypes.object.isRequired,
  onOpen: PropTypes.func.isRequired,
};

/**
 * Every past Instant eval run in this project and view, newest first, with
 * each run's answer split. Opening a run shows its full results again,
 * rebuilt from the task and its evaluators.
 */
export default function InstantEvalHistory({
  projectId,
  unit,
  configsById,
  enabled,
  onOpen,
  onAsk,
}) {
  const meta = unitMeta(unit);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);
  const history = useInstantEvalHistory(projectId, configsById, {
    enabled,
    unit,
    search: query,
  });

  return (
    <Stack spacing={1.5}>
      <TextField
        size="small"
        fullWidth
        placeholder="Search questions"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        inputProps={{ "aria-label": "Search past questions" }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Iconify
                icon="mdi:magnify"
                width={18}
                sx={{ color: "text.disabled" }}
              />
            </InputAdornment>
          ),
        }}
      />
      {unit === "traces" && (
        <Stack direction="row" spacing={0.75} alignItems="flex-start">
          <Iconify
            icon="mdi:table-column"
            width={16}
            sx={{ color: "text.secondary", mt: "2px", flexShrink: 0 }}
          />
          <Typography variant="caption" color="text.secondary">
            Trace answers also stay on the Traces grid: every question is a
            column you can filter by.
          </Typography>
        </Stack>
      )}

      {history.isLoading ? (
        <Stack spacing={1} aria-label="Loading past runs">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} variant="rounded" height={56} />
          ))}
        </Stack>
      ) : history.isError ? (
        <Alert
          severity="error"
          action={
            <Button
              size="small"
              onClick={() => history.refetch()}
              sx={{ textTransform: "none" }}
            >
              Retry
            </Button>
          }
        >
          Past runs couldn&apos;t be loaded.
        </Alert>
      ) : history.runs.length ? (
        <Box
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
          }}
        >
          {history.runs.map((runItem) => (
            <HistoryRow
              key={runItem.taskId}
              runItem={runItem}
              onOpen={onOpen}
            />
          ))}
        </Box>
      ) : query ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          No past question matches &ldquo;{query}&rdquo;.
        </Typography>
      ) : (
        <Stack spacing={1} alignItems="flex-start" sx={{ py: 2 }}>
          <Typography variant="body2" color="text.secondary">
            No Instant eval runs on {meta.plural} yet. Every question you ask
            here is kept, with its answers.
          </Typography>
          <Button
            size="small"
            variant="outlined"
            onClick={onAsk}
            sx={{ textTransform: "none" }}
          >
            Ask a question
          </Button>
        </Stack>
      )}

      {history.hasMore && !history.isLoading && (
        <Button
          size="small"
          onClick={() => history.loadMore()}
          disabled={history.isFetchingMore}
          sx={{ alignSelf: "flex-start", textTransform: "none" }}
        >
          {history.isFetchingMore ? "Loading older runs…" : "Show older runs"}
        </Button>
      )}
    </Stack>
  );
}

InstantEvalHistory.propTypes = {
  projectId: PropTypes.string.isRequired,
  unit: PropTypes.oneOf(["traces", "spans", "sessions", "users"]).isRequired,
  configsById: PropTypes.object.isRequired,
  enabled: PropTypes.bool,
  onOpen: PropTypes.func.isRequired,
  onAsk: PropTypes.func.isRequired,
};
