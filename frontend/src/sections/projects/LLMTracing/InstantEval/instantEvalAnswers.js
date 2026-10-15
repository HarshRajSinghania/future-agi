import { unitWord } from "src/sections/projects/observePopulation";

// Answers of one Instant eval run, as the answers endpoint returns them: one
// row per trace, session or user, each with an answer per question. A user's
// answer is the most common answer across their sessions, with the per-label
// counts alongside.

export const ERROR_ANSWER = "__error__";
export const SKIPPED_ANSWER = "__skipped__";
// Below this Jev is flagged as unsure of its answer.
export const LOW_CONFIDENCE = 0.6;

export const EMPTY_ANSWERS = { rows: [], answered: 0, loaded: false };

const numberOrNull = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const answer =
    typeof entry.answer === "string" && entry.answer ? entry.answer : null;
  if (!answer) return null;
  const counts =
    entry.counts && typeof entry.counts === "object"
      ? Object.fromEntries(
          Object.entries(entry.counts).filter(
            ([, count]) => typeof count === "number" && count > 0,
          ),
        )
      : null;
  return {
    answer,
    confidence: numberOrNull(entry.confidence),
    counts,
    explanation:
      typeof entry.explanation === "string" ? entry.explanation.trim() : "",
  };
}

export function normalizeAnswers(result) {
  const rows = (result?.rows || [])
    .filter((row) => row && row.id)
    .map((row) => ({
      id: String(row.id),
      label: row.label || "",
      excerpt: row.excerpt || "",
      time: row.time || "",
      userId: row.user_id || "",
      endUserId: row.end_user_id || "",
      sessions: typeof row.sessions === "number" ? row.sessions : null,
      answers: Object.fromEntries(
        Object.entries(row.answers || {})
          .map(([configId, entry]) => [configId, normalizeEntry(entry)])
          .filter(([, entry]) => entry),
      ),
    }));
  return { rows, answered: rows.length, loaded: true };
}

export const isFailure = (answer) =>
  answer === ERROR_ANSWER || answer === SKIPPED_ANSWER;

export const answerText = (answer) =>
  answer === ERROR_ANSWER
    ? "Failed"
    : answer === SKIPPED_ANSWER
      ? "Skipped"
      : answer || "";

export const isUnsure = (entry) =>
  entry?.confidence != null &&
  entry.confidence < LOW_CONFIDENCE &&
  !isFailure(entry.answer);

// Rows that have every question answered (or failed). Users count their
// sessions, since that is what the task's progress counts.
export function answeredCount(answers, items, unit) {
  const done = (answers?.rows || []).filter((row) =>
    items.every((item) => row.answers[item.configId]),
  );
  if (unit === "users")
    return done.reduce((sum, row) => sum + (row.sessions || 1), 0);
  return done.length;
}

/**
 * One question's distribution: each label with its count and share of every
 * answered row, then failures and skips (kept apart from the labels so a
 * category can never be confused with them), and how often Jev was unsure.
 */
export function summarizeQuestion(rows, item) {
  const labels = [...(item?.labels || [])];
  const tally = new Map(labels.map((label) => [label, 0]));
  let errors = 0;
  let skipped = 0;
  let unsure = 0;
  let total = 0;
  rows.forEach((row) => {
    const entry = row.answers?.[item.configId];
    if (!entry) return;
    total += 1;
    if (entry.answer === ERROR_ANSWER) errors += 1;
    else if (entry.answer === SKIPPED_ANSWER) skipped += 1;
    else {
      // A label the question no longer lists (an edited evaluator) still
      // counts, after the current labels.
      if (!tally.has(entry.answer)) tally.set(entry.answer, 0);
      tally.set(entry.answer, tally.get(entry.answer) + 1);
      if (isUnsure(entry)) unsure += 1;
    }
  });
  const share = (count) => (total ? count / total : 0);
  return {
    total,
    labels: [...tally.entries()].map(([label, count]) => ({
      label,
      count,
      share: share(count),
    })),
    errors: { count: errors, share: share(errors) },
    skipped: { count: skipped, share: share(skipped) },
    unsure,
  };
}

export function filterRows(rows, { configId, answer, unsureOnly, ids } = {}) {
  return rows.filter((row) => {
    const entry = row.answers?.[configId];
    if (answer && entry?.answer !== answer) return false;
    if (unsureOnly && !isUnsure(entry)) return false;
    if (ids && !ids.has(row.id)) return false;
    return true;
  });
}

// "Yes 2 · No 1" for a user, most common first.
export function labelCountsText(counts) {
  return Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${answerText(label)} ${count}`)
    .join(" · ");
}

export const quoted = (text) => `“${text}”`;

/**
 * Seed for an Insights report over the rows that got one answer.
 */
export function insightsSeedFromAnswers({ unit, item, answer, rows }) {
  const matching = filterRows(rows, { configId: item.configId, answer });
  const count = matching.length;
  const noun = unitWord(unit, count);
  const subject = count === 1 ? `this ${noun}` : `these ${noun}`;
  const label = answerText(answer);
  return {
    unit,
    population: matching.map((row) => ({
      id: row.id,
      time: row.time || "",
      user_id: row.userId || "",
    })),
    question: `Why did ${subject} get ${quoted(label)} for ${quoted(item.question)}?`,
    label: `${quoted(label)} answers · ${item.question}`,
    source: `Instant eval: ${item.question}`,
  };
}

const metricNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
};

// Latency, cost and status from the trace grid's rows, by trace id.
export function traceMetrics(gridRows = []) {
  return new Map(
    gridRows
      .filter((row) => row?.trace_id)
      .map((row) => [
        row.trace_id,
        {
          status: row.status,
          latency: metricNumber(row.latency),
          cost: metricNumber(row.cost),
          tokens: metricNumber(row.total_tokens),
        },
      ]),
  );
}

/**
 * Trace answers in the shape the heatmap and behaviour views read: oldest
 * first, skipped answers left unanswered, failures marked as errors.
 */
export function traceRecords(rows, items, metrics = new Map()) {
  return rows
    .map((row) => ({
      traceId: row.id,
      time: row.time,
      input: row.excerpt,
      status: metrics.get(row.id)?.status,
      latency: metrics.get(row.id)?.latency ?? null,
      cost: metrics.get(row.id)?.cost ?? null,
      tokens: metrics.get(row.id)?.tokens ?? null,
      answers: Object.fromEntries(
        items.map((item) => {
          const answer = row.answers?.[item.configId]?.answer;
          return [
            item.configId,
            answer === SKIPPED_ANSWER ? undefined : answer,
          ];
        }),
      ),
    }))
    .filter((record) => record.time)
    .sort((a, b) => new Date(a.time) - new Date(b.time));
}
