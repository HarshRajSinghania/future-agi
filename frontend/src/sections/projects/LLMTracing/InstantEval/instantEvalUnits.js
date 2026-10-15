import { UNITS, unitWord } from "src/sections/projects/observePopulation";
import {
  ANSWER_TYPES,
  MAX_QUESTIONS,
  TRACE_LIMIT_OPTIONS,
  cleanCategories,
  readsFor,
} from "./instantEvalPayloads";

// How Instant eval runs over each view. Every question is an eval task over
// the exact rows in view when the run starts: the newest trace, span or
// session ids the grid shows. A user question asks about each user's latest
// sessions and the answers roll up per user. Naming the rows outright keeps
// the run to what was on screen and takes the backend's fast path.

export const SESSIONS_PER_USER = 5;

export const LIMIT_OPTIONS = {
  traces: TRACE_LIMIT_OPTIONS,
  spans: TRACE_LIMIT_OPTIONS,
  sessions: [25, 50, 100, 200],
  users: [10, 25, 50, 100],
};

export const DEFAULT_LIMIT = { traces: 50, spans: 50, sessions: 50, users: 25 };

export const TASK_PREFIX = "Instant eval";

export const unitMeta = (unit) => UNITS[unit] || UNITS.traces;

export const defaultReads = (unit) => readsFor(unit)[0];

// A read choice only applies to the view that offers it.
export const normalizeReads = (unit, reads) =>
  readsFor(unit).includes(reads) ? reads : defaultReads(unit);

const taskName = (items) =>
  `${TASK_PREFIX} · ${items[0]?.question || ""}`.slice(0, 255);

// The grid's scope filters carry the date window as a created_at "between"
// item; eval tasks take it as a sibling date_range instead.
const isWindowItem = (item) =>
  item?.column_id === "created_at" &&
  item?.filter_config?.filter_op === "between" &&
  Array.isArray(item?.filter_config?.filter_value);

export const filtersWindow = (filters = []) =>
  (filters || []).find(isWindowItem)?.filter_config?.filter_value;

export function splitScopeFilters(scopeFilters = []) {
  let dateRange;
  const filters = [];
  scopeFilters.forEach((item) => {
    if (isWindowItem(item)) dateRange = item.filter_config.filter_value;
    else if (item) filters.push(item);
  });
  return { dateRange, filters };
}

// The eval task row type and the filter key that names its rows. A user
// question is answered session by session.
const ROW_KEYS = {
  traces: { rowType: "traces", key: "trace_id" },
  spans: { rowType: "spans", key: "span_id" },
  sessions: { rowType: "sessions", key: "session_id" },
  users: { rowType: "sessions", key: "session_id" },
};

/**
 * The task for one run: the questions' evaluators over exactly these rows.
 * An id list with nothing else beside it is what the backend answers fastest
 * (no time-sliced row proof, one batch of up to 32 at a time).
 */
export function idsTaskPayload({ projectId, items, unit, ids }) {
  const { rowType, key } = ROW_KEYS[unit] || ROW_KEYS.traces;
  return {
    name: taskName(items),
    project: projectId,
    evals: items.map((item) => item.configId),
    filters: { [key]: ids },
    run_type: "historical",
    row_type: rowType,
    spans_limit: ids.length,
    sampling_rate: 100,
  };
}

// Traces named by id, as one membership filter on the trace list.
export const traceIdsFilter = (ids) => ({
  column_id: "trace_id",
  filter_config: {
    filter_type: "text",
    filter_op: "in",
    filter_value: ids,
  },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The users list identifies each row by its end_user_id; the user-sessions
// lookup only takes those.
export const endUserIds = (items = []) => [
  ...new Set(
    items
      .map((item) => (typeof item === "string" ? item : item?.id))
      .filter((id) => typeof id === "string" && UUID.test(id)),
  ),
];

export const userSessionsRequest = ({ projectId, userIds, filters }) => {
  const window = filtersWindow(filters);
  return {
    project_id: projectId,
    end_user_ids: userIds,
    per_user: SESSIONS_PER_USER,
    ...(window?.length === 2 ? { window } : {}),
  };
};

export const sessionIdsFromUserSessions = (result) => [
  ...new Set(
    (result?.sessions || [])
      .map((session) => session?.session_id)
      .filter(Boolean),
  ),
];

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// "Past 7D · 2 filters": the date label plus every filter that is not the
// window itself.
export function scopeLabel({ label, filters = [] }) {
  const count = filters.filter((item) => item && !isWindowItem(item)).length;
  const base = label || "This view";
  return count ? `${base} · ${plural(count, "filter")}` : base;
}

export const formatCount = (count, lowerBound) =>
  `${Number(count || 0).toLocaleString()}${lowerBound ? "+" : ""}`;

// What a population read proves about the view's size. A read that filled
// its limit without an exact total from the list only proves "at least".
export function populationCount(population) {
  if (!population) return null;
  const read = population.items?.length ?? 0;
  const count = Math.max(population.total ?? read, read);
  const filled = Boolean(population.limit) && read >= population.limit;
  return {
    count,
    lowerBound:
      Boolean(population.totalIsLowerBound) || (filled && count <= read),
  };
}

// The scope line at the top of the drawer.
export function scopeLine({ unit, population, label, handedOver }) {
  if (handedOver) {
    const count = handedOver.ids.length;
    return `${count.toLocaleString()} ${unitWord(unit, count)} from ${
      handedOver.label || "a hand-off"
    }`;
  }
  const size = populationCount(population);
  if (!size) return label || "";
  return `${formatCount(size.count, size.lowerBound)} ${unitWord(
    unit,
    size.lowerBound ? 2 : size.count,
  )} in this view${label ? ` · ${label}` : ""}`;
}

// How many rows a run will take: the chosen limit, capped by what is in view
// when the view's count is exact.
export function runCoverage({ limit, population, handedOver }) {
  if (handedOver) return Math.min(limit, handedOver.ids.length);
  const size = populationCount(population);
  if (!size || size.lowerBound) return limit;
  return Math.min(limit, size.count);
}

export function runButtonLabel({ unit, coverage }) {
  return `Ask Jev about ${coverage.toLocaleString()} ${unitWord(unit, coverage)}`;
}

export function limitHelp({ unit, limit }) {
  if (unit === "users")
    return `Jev reads each user's latest ${SESSIONS_PER_USER} sessions in this window (up to ${(
      limit * SESSIONS_PER_USER
    ).toLocaleString()} sessions) and rolls the answers up per user.`;
  return `The newest ${unitMeta(unit).plural} in this view.`;
}

export const limitOptionLabel = (unit, value) =>
  unit === "users"
    ? `Up to ${value} users × ${SESSIONS_PER_USER} sessions`
    : `Up to ${value} ${unitMeta(unit).plural}`;

// Per-question share of the task's progress. Every question is evaluated for
// every row, so task counts divide evenly across questions.
export function progressCounts(progress = {}, questionCount = 1) {
  const per = Math.max(1, questionCount);
  const share = (value) => Math.round((value || 0) / per);
  return {
    status: progress.status,
    total: share(progress.total_count),
    completed: share(progress.success_count),
    failed: share((progress.errors_count || 0) + (progress.skipped_count || 0)),
    // Rows that will have an answer once results land (skipped rows may not).
    expected: share(
      (progress.success_count || 0) + (progress.errors_count || 0),
    ),
    errorGroups: progress.error_groups || [],
  };
}

export const emptyDraft = () => ({
  question: "",
  answerType: ANSWER_TYPES.YES_NO,
  categories: [],
  definitions: {},
});

// Questions handed over from Insights (or a saved question) as editor drafts.
export function draftsFromQuestions(questions = []) {
  const drafts = (Array.isArray(questions) ? questions : [])
    .filter((entry) => entry && typeof entry.question === "string")
    .slice(0, MAX_QUESTIONS)
    .map((entry) => {
      const isCategory =
        entry.answerType === ANSWER_TYPES.CATEGORY ||
        entry.answer_type === ANSWER_TYPES.CATEGORY;
      const categories = isCategory
        ? cleanCategories(entry.categories || entry.labels || [])
        : [];
      return {
        question: entry.question,
        answerType: isCategory ? ANSWER_TYPES.CATEGORY : ANSWER_TYPES.YES_NO,
        categories,
        definitions:
          entry.definitions && typeof entry.definitions === "object"
            ? { ...entry.definitions }
            : {},
      };
    });
  return drafts.length ? drafts : [emptyDraft()];
}

// A hand-off's rows only apply to the view it was meant for.
export function handedOverScope(seed, unit) {
  if (!seed || seed.unit !== unit) return null;
  const ids = [
    ...new Set(
      (Array.isArray(seed.ids) ? seed.ids : [])
        .map((id) => (typeof id === "string" ? id : id?.id))
        .filter(Boolean),
    ),
  ];
  return ids.length ? { ids, label: seed.label || "" } : null;
}

// "8 s", "1 min 5 s".
export const formatSeconds = (seconds) => {
  const whole = Math.max(0, Math.round(seconds || 0));
  return whole >= 60
    ? `${Math.floor(whole / 60)} min ${whole % 60} s`
    : `${whole} s`;
};

export const formatDuration = (from, to) =>
  formatSeconds((new Date(to) - new Date(from)) / 1000);

export const formatWhen = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

// "just now", "4 min ago", "3 h ago", "Oct 12".
export function formatAgo(value, now = Date.now()) {
  if (!value) return "";
  const seconds = (now - new Date(value).getTime()) / 1000;
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  if (seconds < 7 * 86400) {
    const days = Math.round(seconds / 86400);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// How many rows a run asked about, in the unit the results list shows. A past
// user run only knows its sessions, which aren't rows of this list.
export const askedRows = (run, unit) =>
  run.asked?.rows ||
  (unit === "users" ? run.asked?.users : run.progress?.total) ||
  0;

/**
 * One line on where a run is: finding rows, saving evaluators, Jev reading
 * ("32 of 50 sessions answered · 8 s"), or what was answered and how long it
 * took ("50 sessions answered in 14 s"). `answeredRows` are the rows with
 * every question answered; `now` drives the elapsed clock.
 */
export function runStatusText(run, unit, answeredRows = 0, now = Date.now()) {
  const meta = unitMeta(unit);
  const elapsed =
    run.startedAt && !run.viewing
      ? ` · ${formatSeconds((now - new Date(run.startedAt).getTime()) / 1000)}`
      : "";
  switch (run.phase) {
    case "collecting":
      return `${
        unit === "users"
          ? "Finding the users in this view and their latest sessions…"
          : `Finding the ${meta.plural} in this view…`
      }${elapsed}`;
    case "creating":
      return `Saving the questions as Jev evaluators…${elapsed}`;
    case "running": {
      const total = askedRows(run, unit);
      if (!total)
        return run.viewing
          ? "Loading this run…"
          : `Starting the run…${elapsed}`;
      const done = Math.min(answeredRows, total);
      const fromSessions =
        unit === "users" && run.asked?.sessions
          ? ` (${plural(run.asked.sessions, "session")})`
          : "";
      return `${done.toLocaleString()} of ${total.toLocaleString()} ${unitWord(
        unit,
        total,
      )}${fromSessions} answered${elapsed}${
        run.reconnecting ? " · reconnecting…" : ""
      }`;
    }
    case "done": {
      if (run.empty) return run.empty;
      const total = askedRows(run, unit);
      const count = `${answeredRows.toLocaleString()}${
        total && total !== answeredRows ? ` of ${total.toLocaleString()}` : ""
      } ${unitWord(unit, total || answeredRows)} answered`;
      const fromSessions =
        unit === "users" && run.asked?.sessions
          ? ` from ${plural(run.asked.sessions, "session")}`
          : "";
      const when =
        run.viewing && run.startedAt
          ? ` · ran ${formatWhen(run.startedAt)}`
          : run.startedAt && run.finishedAt
            ? ` in ${formatDuration(run.startedAt, run.finishedAt)}`
            : "";
      return `${count}${fromSessions}${when}`;
    }
    default:
      return "";
  }
}
