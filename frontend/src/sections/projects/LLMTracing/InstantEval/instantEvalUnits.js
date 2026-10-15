import { UNITS, unitWord } from "src/sections/projects/observePopulation";
import {
  ANSWER_TYPES,
  MAX_QUESTIONS,
  TRACE_LIMIT_OPTIONS,
  TRACE_READS,
  cleanCategories,
} from "./instantEvalPayloads";

// How Instant eval runs over each view. A trace question is an eval task over
// the view's filters; a session question is an eval task over the exact
// session ids in view; a user question asks about each user's latest sessions
// and the answers roll up per user.

export const SESSIONS_PER_USER = 5;

export const LIMIT_OPTIONS = {
  traces: TRACE_LIMIT_OPTIONS,
  sessions: [25, 50, 100, 200],
  users: [10, 25, 50, 100],
};

export const DEFAULT_LIMIT = { traces: 100, sessions: 50, users: 25 };

export const TASK_PREFIX = "Instant eval";

export const unitMeta = (unit) => UNITS[unit] || UNITS.traces;

export const defaultReads = (unit) =>
  unit === "traces" ? "input_output" : "transcript";

// Sessions and users always read the whole conversation; traces pick a field.
export const normalizeReads = (unit, reads) =>
  unit === "traces"
    ? TRACE_READS.includes(reads)
      ? reads
      : "input_output"
    : "transcript";

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

export function tracesTaskPayload({ projectId, items, limit, scopeFilters }) {
  const { dateRange, filters } = splitScopeFilters(scopeFilters);
  return {
    name: taskName(items),
    project: projectId,
    evals: items.map((item) => item.configId),
    filters: {
      ...(dateRange ? { date_range: dateRange } : {}),
      ...(filters.length ? { filters } : {}),
    },
    run_type: "historical",
    row_type: "traces",
    spans_limit: limit,
    sampling_rate: 100,
  };
}

// Sessions are answered by id, so the task reads exactly the sessions that
// were in view when the run started.
export const sessionsTaskPayload = ({ projectId, items, sessionIds }) => ({
  name: taskName(items),
  project: projectId,
  evals: items.map((item) => item.configId),
  filters: { session_id: sessionIds },
  run_type: "historical",
  row_type: "sessions",
  spans_limit: sessionIds.length,
  sampling_rate: 100,
});

// Traces handed over by id (from Analyse) become one membership filter.
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

// Questions handed over from Analyse (or a saved question) as editor drafts.
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

export const formatDuration = (from, to) => {
  const seconds = Math.max(
    0,
    Math.round((new Date(to) - new Date(from)) / 1000),
  );
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;
};

export const formatWhen = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

/**
 * One line on where a run is: finding rows, saving evaluators, Jev reading
 * (with progress), or what was answered and how long it took.
 */
export function runStatusText(run, unit, answeredRows = 0) {
  const meta = unitMeta(unit);
  // A user question is answered session by session.
  const readWord = unit === "users" ? "sessions" : meta.plural;
  switch (run.phase) {
    case "collecting":
      return unit === "users"
        ? "Finding the users in this view and their latest sessions…"
        : `Finding the ${meta.plural} in this view…`;
    case "creating":
      return "Saving the questions as Jev evaluators…";
    case "running": {
      const total = run.progress?.total;
      if (!total)
        return run.viewing ? "Loading this run…" : "Starting the run…";
      const processed = Math.min(
        (run.progress.completed || 0) + (run.progress.failed || 0),
        total,
      );
      return `Jev is reading ${readWord} · ${processed} of ${total}`;
    }
    case "done": {
      if (run.empty) return run.empty;
      const asked = unit === "users" ? run.asked?.users : run.asked?.sessions;
      const total = unit === "users" ? asked : run.progress?.total || asked;
      const count = `${answeredRows.toLocaleString()}${
        total && total !== answeredRows ? ` of ${total.toLocaleString()}` : ""
      } ${unitWord(unit, total || answeredRows)} answered`;
      const fromSessions =
        unit === "users" && run.asked?.sessions
          ? ` from ${plural(run.asked.sessions, "session")}`
          : "";
      const when =
        run.viewing && run.startedAt
          ? ` · run on ${formatWhen(run.startedAt)}`
          : run.startedAt && run.finishedAt
            ? ` in ${formatDuration(run.startedAt, run.finishedAt)}`
            : "";
      return `${count}${fromSessions}${when}`;
    }
    default:
      return "";
  }
}
