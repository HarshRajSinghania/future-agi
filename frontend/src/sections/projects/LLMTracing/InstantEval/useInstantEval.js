import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import axios, { endpoints, readQuery } from "src/utils/axios";
import { getSafeActionErrorMessage } from "src/utils/errorUtils";
import { collectPopulation } from "src/sections/projects/observePopulation";
import {
  ANSWER_TYPES,
  INSTANT_EVAL_MODEL,
  YES_NO_LABELS,
  answerLabels,
  buildEvalMapping,
  buildTemplatePayload,
  cleanDefinitions,
} from "./instantEvalPayloads";
import {
  endUserIds,
  idsTaskPayload,
  normalizeReads,
  progressCounts,
  sessionIdsFromUserSessions,
  splitScopeFilters,
  traceIdsFilter,
  unitMeta,
  userSessionsRequest,
} from "./instantEvalUnits";
import {
  EMPTY_ANSWERS,
  ERROR_ANSWER,
  normalizeAnswers,
  traceMetrics,
} from "./instantEvalAnswers";

export { ERROR_ANSWER };

// Answers are read from the first second and then every 2 s, so they fill in
// while Jev works; the task's progress (for failures and its end) with every
// other read. A poll starts only once the previous one has finished.
const FIRST_POLL_MS = 1000;
const POLL_MS = 2000;
const PROGRESS_EVERY = 2;
// A run that hasn't finished after this long is shown as stalled rather than
// polled forever (a paused or stuck task never reaches a terminal status).
const MAX_FOLLOW_MS = 30 * 60 * 1000;
// How long answers may be unreadable (a restart, a dropped connection)
// before the run is reported as lost; reads back off meanwhile.
const MAX_SILENT_MS = 3 * 60 * 1000;
const RETRY_MS = 3000;
// Answers land a few reads after the task finishes.
const ANSWER_SETTLE_ATTEMPTS = 6;
const MAX_METRIC_ROWS = 500;
const TERMINAL_TASK_STATUSES = new Set([
  "completed",
  "failed",
  "deleted",
  "paused",
]);
const storageKey = (projectId, unit) => `instant-eval-run:${projectId}:${unit}`;

const IDLE = {
  phase: "idle",
  items: [],
  answers: EMPTY_ANSWERS,
  progress: null,
};

const result = (response) => response?.data?.result;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readStored = (projectId, unit) => {
  try {
    const raw = globalThis.sessionStorage?.getItem(storageKey(projectId, unit));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeStored = (projectId, unit, value) => {
  try {
    if (value)
      globalThis.sessionStorage?.setItem(
        storageKey(projectId, unit),
        JSON.stringify(value),
      );
    else globalThis.sessionStorage?.removeItem(storageKey(projectId, unit));
  } catch {
    // Session storage unavailable: the run still completes server-side.
  }
};

// What survives closing the drawer or reloading the page: enough to resume
// following the task, or to reload a finished run's answers.
const storable = (run) => ({
  phase: run.phase,
  taskId: run.taskId,
  items: run.items,
  scopeFilters: run.scopeFilters,
  scopeLabel: run.scopeLabel,
  handedOver: run.handedOver,
  limit: run.limit,
  reads: run.reads,
  asked: run.asked,
  placeholders: run.placeholders,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  error: run.error,
  viewing: run.viewing,
});

export function buildAnswerFilter(item, labels) {
  return {
    column_id: item.configId,
    property_id: `eval_config:${item.configId}`,
    display_name: item.question,
    filter_config: {
      filter_type: "text",
      filter_op: "in",
      filter_value: labels,
      col_type: "EVAL_METRIC",
    },
  };
}

export function itemFromConfig(config) {
  const meta = config?.config?.instant_eval;
  if (!meta?.question) return null;
  return {
    configId: config.id,
    name: config.name,
    templateId: config.eval_template,
    question: meta.question,
    answerType: meta.answer_type,
    labels: meta.labels || [],
    definitions: meta.definitions || {},
    reads: meta.reads,
    // Questions saved before sessions and users had Instant eval were all
    // asked about traces.
    unit: meta.unit || "traces",
  };
}

const configName = (question, taken) => {
  const base = question.trim().replace(/\s+/g, " ").slice(0, 200);
  let name = base;
  let n = 2;
  while (taken.has(name.toLowerCase())) name = `${base} (${n++})`;
  taken.add(name.toLowerCase());
  return name;
};

const sameLabels = (a = [], b = []) =>
  a.length === b.length && a.every((label, index) => label === b[index]);

const sameDefinitions = (a = {}, b = {}) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => (a[key] || "") === (b[key] || ""));
};

// A saved question is reused only when it asks the same thing of the same
// kind of row: same wording, answers, definitions, inputs and unit.
export const matchesSavedQuestion = (
  item,
  { text, answerType, labels, definitions, reads, unit },
) =>
  item.question.toLowerCase() === text.toLowerCase() &&
  item.answerType === answerType &&
  item.reads === reads &&
  (item.unit || "traces") === unit &&
  sameLabels(item.labels, labels) &&
  sameDefinitions(item.definitions, definitions);

async function listProjectConfigs(projectId) {
  const response = await axios.get(endpoints.project.getEvalTaskConfig(), {
    params: { project_id: projectId },
  });
  return result(response) || [];
}

// Asking a question that already has an evaluator in this project (same
// wording, answers, inputs and unit) reuses it, so its grid column and history
// stay one series. Only new questions create a Jev template and an eval config.
async function resolveEvaluators({ projectId, questions, reads, unit }) {
  const configs = await listProjectConfigs(projectId);
  const existing = configs.map(itemFromConfig).filter(Boolean).reverse();
  const taken = new Set(
    configs.map((config) => (config.name || "").toLowerCase()),
  );
  const mapping = buildEvalMapping(reads);
  const now = new Date();
  return Promise.all(
    questions.map(async (question, index) => {
      const text = question.question.trim();
      const labels = answerLabels(question);
      const definitions = cleanDefinitions(question.definitions, labels);
      const reuse = existing.find((item) =>
        matchesSavedQuestion(item, {
          text,
          answerType: question.answerType,
          labels,
          definitions,
          reads,
          unit,
        }),
      );
      if (reuse) return reuse;
      const template = await axios.post(
        endpoints.develop.eval.createEvalTemplateV2,
        buildTemplatePayload({
          ...question,
          reads,
          unit,
          now: new Date(now.getTime() + index * 1000),
        }),
      );
      const templateId = result(template)?.id;
      const name = configName(text, taken);
      const config = await axios.post(
        endpoints.project.createEvalTaskConfig(),
        {
          project: projectId,
          eval_template: templateId,
          name,
          model: INSTANT_EVAL_MODEL,
          mapping,
          error_localizer: false,
          config: {
            mapping,
            run_config: { model: INSTANT_EVAL_MODEL },
            instant_eval: {
              question: text,
              answer_type: question.answerType,
              labels,
              ...(Object.keys(definitions).length ? { definitions } : {}),
              reads,
              unit,
            },
          },
        },
      );
      return {
        configId: result(config)?.id,
        templateId,
        name,
        question: text,
        answerType: question.answerType,
        labels,
        definitions,
        reads,
        unit,
      };
    }),
  );
}

/**
 * The rows a run asks about, named by id: the newest traces, spans or
 * sessions in view (or the rows handed over), or each user's latest sessions
 * in the view's window. `placeholders` are the rows the results list shows
 * from the start, before Jev has answered any of them.
 */
async function collectTarget({ projectId, unit, limit, scope }) {
  const handedOver = scope?.handedOver;
  const filters = scope?.filters || [];
  const noun = unitMeta(unit).plural;
  // The rows the drawer already read to count the view are the rows on
  // screen when the question was asked; only without them is the list read.
  const population = handedOver
    ? null
    : scope?.population?.items
      ? scope.population
      : await collectPopulation({ unit, projectId, filters, limit });
  const items = handedOver
    ? handedOver.ids.slice(0, limit).map((id) => ({ id }))
    : population.items.slice(0, limit);
  const ids = items.map((item) => item.id);
  if (unit !== "users") {
    if (!ids.length)
      return { empty: `There are no ${noun} in this view to ask about.` };
    return { ids, placeholders: items, asked: { rows: ids.length } };
  }
  const userIds = endUserIds(ids);
  if (!userIds.length)
    return { empty: "There are no users in this view to ask about." };
  const response = await axios.post(
    endpoints.project.instantEvalUserSessions(),
    userSessionsRequest({
      projectId,
      userIds,
      // A hand-off names its users; their latest sessions are read whenever
      // they happened.
      filters: handedOver ? [] : filters,
    }),
  );
  const sessions = result(response)?.sessions || [];
  const sessionIds = sessionIdsFromUserSessions(result(response));
  if (!sessionIds.length)
    return { empty: "None of these users had a session in this window." };
  // Only users with a session in the window get an answer row.
  const answeredUsers = new Set(sessions.map((session) => session.end_user_id));
  const placeholders = items.filter((item) => answeredUsers.has(item.id));
  return {
    ids: sessionIds,
    placeholders,
    asked: {
      rows: placeholders.length || answeredUsers.size,
      users: result(response)?.users ?? answeredUsers.size,
      sessions: sessionIds.length,
    },
  };
}

async function createTask({ projectId, unit, items, ids }) {
  const response = await axios.post(
    endpoints.project.createEvalTask(),
    idsTaskPayload({ projectId, items, unit, ids }),
  );
  return result(response)?.id;
}

const LIVE_TASK_PREFIX = "Instant eval (live)";
const LIVE_TASK_PAGE_SIZE = 50;
const LIVE_TASK_MAX_PAGES = 20;

// Same evaluators, same view filters, no date window: answers every new trace
// (or span) that matches this view as it arrives.
export async function createContinuousTask({
  projectId,
  items,
  scopeFilters,
  unit = "traces",
}) {
  const { filters } = splitScopeFilters(scopeFilters);
  const response = await axios.post(endpoints.project.createEvalTask(), {
    name: `${LIVE_TASK_PREFIX} · ${items[0].question}`.slice(0, 255),
    project: projectId,
    evals: items.map((item) => item.configId),
    filters: filters.length ? { filters } : {},
    run_type: "continuous",
    row_type: unit === "spans" ? "spans" : "traces",
    sampling_rate: 100,
  });
  return result(response)?.id;
}

async function fetchProgress(taskId) {
  const response = await axios.get(endpoints.project.getEvalTaskLogs(), {
    params: { eval_task_id: taskId },
  });
  return result(response) || {};
}

export async function fetchAnswers({ projectId, taskId, unit, items }) {
  const response = await axios.get(endpoints.project.instantEvalAnswers(), {
    params: {
      project_id: projectId,
      eval_task_id: taskId,
      unit,
      config_ids: items
        .map((item) => item.configId)
        .filter(Boolean)
        .join(","),
    },
  });
  return normalizeAnswers(result(response));
}

// Latency, cost and status of a trace run's rows, read from the trace list
// by their ids.
async function fetchTraceMetrics({ projectId, traceIds }) {
  const ids = (traceIds || []).slice(0, MAX_METRIC_ROWS);
  if (!ids.length) return new Map();
  const response = await readQuery(
    endpoints.project.getTracesForObserveProject(),
    {
      params: {
        project_id: projectId,
        page_number: 0,
        page_size: ids.length,
        filters: JSON.stringify([traceIdsFilter(ids)]),
      },
    },
  );
  return traceMetrics(result(response)?.table || []);
}

// One live task per set of questions: re-creating it would answer every new
// trace twice and bill twice.
// Live tasks are found by name, page by page, so a long run history can't hide
// an existing one and cause a duplicate.
export async function findContinuousTask({ projectId, items }) {
  const wanted = new Set(items.map((item) => item.name).filter(Boolean));
  const matches = (task) =>
    task.run_type === "continuous" &&
    !["deleted", "failed"].includes(task.status) &&
    (task.evals_applied || []).length === wanted.size &&
    (task.evals_applied || []).every((name) => wanted.has(name));
  for (let page = 0; page < LIVE_TASK_MAX_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const response = await axios.get(endpoints.project.getEvalTaskList(), {
      params: {
        project_id: projectId,
        name: LIVE_TASK_PREFIX,
        page_number: page,
        page_size: LIVE_TASK_PAGE_SIZE,
      },
    });
    const rows = result(response)?.table || [];
    const found = rows.find(matches);
    if (found) return found;
    if (rows.length < LIVE_TASK_PAGE_SIZE) return undefined;
  }
  return undefined;
}

// Plain-language reasons for the task's error groups (normalized messages
// from get_eval_task_logs). Unknown reasons fall back to a generic line.
export const AI_PROVIDERS_SETTINGS_PATH = "/dashboard/settings/ai-providers";

// Jev runs on the organization's own TypeSafe key; key problems point to the
// AI Providers settings where it is added or replaced.
export function explainErrorGroups(groups = []) {
  return groups.map((group) => {
    const text = `${group?.normalized || ""} ${group?.sample || ""}`;
    const count = group?.count || 0;
    if (/JEV_KEY_MISSING|API key not configured for typesafe/i.test(text))
      return {
        count,
        reason:
          "were skipped because this workspace has no TypeSafe key. Add yours in Settings → AI Providers.",
        settingsPath: AI_PROVIDERS_SETTINGS_PATH,
      };
    if (/JEV_KEY_INVALID/i.test(text))
      return {
        count,
        reason:
          "were rejected by TypeSafe because the key in Settings → AI Providers is invalid or revoked.",
        settingsPath: AI_PROVIDERS_SETTINGS_PATH,
      };
    if (/rate_limited/i.test(text))
      return {
        count,
        reason:
          "hit your plan's evaluation rate limit and were not given. Rerun in a minute, or raise the limit on your plan.",
      };
    if (/ENTITLEMENT|jev_models|402/i.test(text))
      return {
        count,
        reason: "were skipped because Jev isn't enabled for this workspace.",
      };
    if (/JEV_INPUT_TOO_LARGE/i.test(text))
      return { count, reason: "were too long for Jev to read." };
    if (
      /JEV_RATE_LIMITED|JEV_TIMEOUT|JEV_PROVIDER_ERROR|JEV_RESPONSE_INVALID/i.test(
        text,
      )
    )
      return {
        count,
        reason: "failed while calling Jev. Rerun to retry them.",
      };
    if (/missing|not found|Required attribute/i.test(text))
      return { count, reason: "had nothing for Jev to read." };
    return { count, reason: "couldn't be evaluated." };
  });
}

function endMessage({ stalled, lost, status, unit }) {
  const noun = unitMeta(unit).noun;
  if (lost)
    return "Lost touch with this run. Jev keeps answering in the background; reopen Instant eval to see the rest.";
  if (stalled)
    return "This run is taking unusually long. Jev keeps answering in the background; reopen Instant eval later to see the rest.";
  if (status === "paused")
    return `This run was paused before every ${noun} was answered.`;
  if (status === "failed")
    return `The run stopped before every ${noun} was answered.`;
  return undefined;
}

// Every row asked about has an answer row and none is still being read.
const allAnswered = (answers, expected) =>
  Boolean(answers?.loaded) &&
  answers.pending === 0 &&
  answers.rows.length > 0 &&
  (!expected || answers.rows.length >= expected);

/**
 * One Instant eval run in one view (traces, spans, sessions or users) of a
 * project. Answers stream in while Jev reads. The run in flight, or the last
 * one finished, is kept per project and unit in session storage, so closing
 * the drawer or reloading the page picks it up; `persist: false` keeps a
 * viewer of past runs out of that slot.
 */
export function useInstantEvalRun(
  projectId,
  unit = "traces",
  { persist = true } = {},
) {
  const [run, setRun] = useState(IDLE);
  const cancelled = useRef(false);
  // Bumped whenever the screen moves on (new run, past run, reset, project
  // switch), so an older run still being created or polled can't take the
  // screen back.
  const generation = useRef(0);

  const follow = useCallback(
    async (base, mine) => {
      const isCurrent = () => !cancelled.current && generation.current === mine;
      const { taskId, items } = base;
      // The answers endpoint returns users, not the sessions they were asked
      // about; only an exact row count can end a run early.
      const expected = base.asked?.rows || 0;
      let progress = progressCounts({}, items.length);
      let answers = null;
      let stalled = false;
      let lastRead = Date.now();
      let failing = false;
      let settleAttempts = 0;
      let pollStarted = Date.now();
      const deadline = Date.now() + MAX_FOLLOW_MS;
      for (let tick = 0; isCurrent(); tick += 1) {
        // Every 2 s from the start of the last poll, never overlapping it.
        const wait =
          tick === 0
            ? base.viewing
              ? 0
              : FIRST_POLL_MS
            : failing
              ? RETRY_MS
              : POLL_MS - (Date.now() - pollStarted);
        // eslint-disable-next-line no-await-in-loop
        await sleep(Math.max(0, wait));
        if (!isCurrent()) return;
        if (Date.now() > deadline) {
          stalled = true;
          break;
        }
        pollStarted = Date.now();
        const readProgress =
          tick % PROGRESS_EVERY === 0 || allAnswered(answers, expected);
        // eslint-disable-next-line no-await-in-loop
        const [nextProgress, nextAnswers] = await Promise.all([
          readProgress ? fetchProgress(taskId).catch(() => null) : null,
          fetchAnswers({ projectId, taskId, unit, items }).catch(() => null),
        ]);
        if (nextProgress) progress = progressCounts(nextProgress, items.length);
        if (!isCurrent()) return;
        failing = !nextAnswers;
        if (nextAnswers) {
          answers = nextAnswers;
          lastRead = Date.now();
        } else if (Date.now() - lastRead > MAX_SILENT_MS)
          throw new Error("The run's answers could not be read.");
        const snapshot = {
          progress,
          reconnecting: failing,
          ...(answers ? { answers } : {}),
        };
        setRun((prev) => ({ ...prev, ...snapshot }));
        const terminal = TERMINAL_TASK_STATUSES.has(progress.status);
        const answered = allAnswered(answers, expected);
        // Done as soon as every row named has its answer; a task that ended
        // with rows missing gets a few more reads for late answers.
        if (answered && (terminal || expected)) break;
        if (terminal && (answered || settleAttempts >= ANSWER_SETTLE_ATTEMPTS))
          break;
        if (terminal) settleAttempts += 1;
      }
      if (!isCurrent()) return;
      // Done as soon as the answers are in; the task's failure reasons and a
      // trace run's latency and cost follow without holding the result back.
      setRun((prev) => ({
        ...prev,
        phase: "done",
        progress,
        reconnecting: false,
        finishedAt: prev.finishedAt || new Date().toISOString(),
        error: endMessage({ stalled, status: progress.status, unit }),
        ...(answers ? {} : { answers: { ...EMPTY_ANSWERS, loaded: true } }),
      }));
      const [last, metrics] = await Promise.all([
        stalled || TERMINAL_TASK_STATUSES.has(progress.status)
          ? null
          : fetchProgress(taskId).catch(() => null),
        unit === "traces" && answers?.rows.length
          ? fetchTraceMetrics({
              projectId,
              traceIds: answers.rows.map((row) => row.id),
            }).catch(() => null)
          : null,
      ]);
      if (!isCurrent() || (!last && !metrics)) return;
      setRun((prev) => ({
        ...prev,
        ...(last ? { progress: progressCounts(last, items.length) } : {}),
        ...(metrics ? { metrics } : {}),
      }));
    },
    [projectId, unit],
  );

  // Follows a run and turns a lost connection into a message on screen.
  const followSafely = useCallback(
    (base, mine, message) =>
      follow(base, mine).catch(() => {
        if (cancelled.current || generation.current !== mine) return;
        setRun((prev) => ({
          ...prev,
          phase: "done",
          finishedAt: prev.finishedAt || new Date().toISOString(),
          answers: prev.answers?.loaded
            ? prev.answers
            : { ...EMPTY_ANSWERS, loaded: true },
          error: message || endMessage({ lost: true, unit }),
        }));
      }),
    [follow, unit],
  );

  // A finished run reopened from storage: read its answers once.
  const reload = useCallback(
    async (base, mine) => {
      const isCurrent = () => !cancelled.current && generation.current === mine;
      try {
        const answers = await fetchAnswers({
          projectId,
          taskId: base.taskId,
          unit,
          items: base.items,
        });
        if (!isCurrent()) return;
        setRun((prev) => ({ ...prev, answers }));
        if (unit !== "traces" || !answers.rows.length) return;
        const metrics = await fetchTraceMetrics({
          projectId,
          traceIds: answers.rows.map((row) => row.id),
        }).catch(() => null);
        if (!isCurrent() || !metrics) return;
        setRun((prev) => ({ ...prev, metrics }));
      } catch {
        if (!isCurrent()) return;
        setRun((prev) => ({
          ...prev,
          answers: { ...EMPTY_ANSWERS, loaded: true },
          error: "The answers of this run could not be loaded.",
        }));
      }
    },
    [projectId, unit],
  );

  const launch = useCallback(
    async ({ questions, existingItems, reads, limit, scope }) => {
      generation.current += 1;
      const mine = generation.current;
      cancelled.current = false;
      const stale = () => cancelled.current || generation.current !== mine;
      // The previous run stops being the one to reopen.
      if (persist) writeStored(projectId, unit, null);
      const runReads = normalizeReads(unit, reads || existingItems?.[0]?.reads);
      const pending =
        existingItems ||
        questions.map((q) => ({
          question: q.question.trim(),
          answerType: q.answerType,
          labels: answerLabels(q),
        }));
      setRun({
        ...IDLE,
        phase: "collecting",
        items: pending,
        limit,
        reads: runReads,
        scopeFilters: scope?.filters || [],
        scopeLabel: scope?.label,
        handedOver: scope?.handedOver || null,
        startedAt: new Date().toISOString(),
      });
      try {
        // Saving the evaluators doesn't depend on the rows, so it runs while
        // they are found.
        const evaluators = existingItems
          ? Promise.resolve(existingItems)
          : resolveEvaluators({
              projectId,
              questions,
              reads: runReads,
              unit,
            });
        evaluators.catch(() => {});
        const target = await collectTarget({ projectId, unit, limit, scope });
        if (stale()) return;
        if (target.empty) {
          setRun((prev) => ({
            ...prev,
            phase: "done",
            finishedAt: new Date().toISOString(),
            answers: { ...EMPTY_ANSWERS, loaded: true },
            empty: target.empty,
          }));
          return;
        }
        setRun((prev) => ({
          ...prev,
          phase: "creating",
          asked: target.asked,
          placeholders: target.placeholders,
        }));
        const items = await evaluators;
        if (stale()) return;
        if (items.some((item) => !item.configId))
          throw new Error("The evaluator could not be saved.");
        const taskId = await createTask({
          projectId,
          unit,
          items,
          ids: target.ids,
        });
        if (stale()) return;
        if (!taskId) throw new Error("The run could not be started.");
        setRun((prev) => ({ ...prev, phase: "running", items, taskId }));
        await followSafely({ taskId, items, asked: target.asked }, mine);
      } catch (error) {
        if (stale()) return;
        setRun((prev) => ({
          ...prev,
          phase: "failed",
          error: getSafeActionErrorMessage(
            error,
            "Instant eval could not start. Check your filters and try again.",
          ),
        }));
      }
    },
    [projectId, unit, persist, followSafely],
  );

  const start = useCallback(
    ({ questions, reads, limit, scope }) =>
      launch({ questions, reads, limit, scope }),
    [launch],
  );

  const rerun = useCallback(
    ({ items, limit, scope }) => launch({ existingItems: items, limit, scope }),
    [launch],
  );

  // Open a past run: its evaluators, its stored scope.
  const view = useCallback(
    ({ taskId, items, scopeFilters, startedAt, asked }) => {
      generation.current += 1;
      const mine = generation.current;
      cancelled.current = false;
      const base = {
        ...IDLE,
        phase: "running",
        items,
        taskId,
        scopeFilters,
        startedAt,
        asked: asked || null,
        viewing: true,
      };
      setRun(base);
      followSafely(base, mine, "This run could not be loaded.");
    },
    [followSafely],
  );

  const reset = useCallback(() => {
    generation.current += 1;
    if (persist) writeStored(projectId, unit, null);
    setRun(IDLE);
  }, [projectId, unit, persist]);

  // Keep the run in flight (or the last one finished) for this project+unit.
  useEffect(() => {
    if (!persist || !projectId || !run.taskId) return;
    if (run.phase === "running" || run.phase === "done")
      writeStored(projectId, unit, storable(run));
  }, [persist, projectId, unit, run]);

  // Resume the run that was in flight, or show the last one finished, when the
  // drawer or page opens again.
  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    cancelled.current = false;
    const stored = persist && projectId ? readStored(projectId, unit) : null;
    if (!stored?.taskId || !Array.isArray(stored.items)) {
      setRun(IDLE);
    } else {
      const base = { ...IDLE, ...stored, answers: EMPTY_ANSWERS };
      if (stored.phase === "done") {
        setRun({ ...base, phase: "done" });
        reload(base, mine);
      } else {
        setRun({ ...base, phase: "running" });
        followSafely(
          base,
          mine,
          "The run that was in progress could not be resumed. Jev keeps answering in the background.",
        );
      }
    }
    return () => {
      cancelled.current = true;
    };
  }, [persist, projectId, unit, followSafely, reload]);

  return { run, start, rerun, view, reset };
}

/**
 * Questions saved by Instant eval in this project. `items` has one entry per
 * question (the newest evaluator for it), optionally only those asked about
 * one unit; `all` keeps every evaluator for matching runs back to questions.
 */
export function useInstantEvals(projectId, { enabled = true, unit } = {}) {
  const query = useQuery({
    queryKey: ["instant-evals", projectId],
    enabled: Boolean(projectId) && enabled,
    queryFn: () =>
      axios.get(endpoints.project.getEvalTaskConfig(), {
        params: { project_id: projectId },
      }),
    select: (response) => {
      const configs = result(response) || [];
      return configs.map(itemFromConfig).filter(Boolean).reverse();
    },
    staleTime: 30_000,
  });
  const all = query.data || [];
  const seen = new Set();
  // One entry per question: re-asking a question creates a new evaluator,
  // and the newest one is the one worth re-applying.
  const items = all.filter((item) => {
    if (unit && item.unit !== unit) return false;
    const key = item.question.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    all,
    items,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

const HISTORY_PAGE_SIZE = 20;
// A history page is read again this often while one of its runs is still
// being answered.
const HISTORY_LIVE_MS = 5000;
const LIVE_RUN_STATUSES = new Set(["pending", "running"]);

export const isLiveRun = (runItem) =>
  runItem.pending > 0 || LIVE_RUN_STATUSES.has(runItem.status);

// A question whose evaluator config is gone, rebuilt from what the run
// counted, so its answers still read.
function fallbackItem(configId, question, counts = {}) {
  const labels = Object.keys(counts).filter((label) => !label.startsWith("__"));
  const yesNo = labels.every((label) => YES_NO_LABELS.includes(label));
  return {
    configId,
    question,
    answerType: yesNo ? ANSWER_TYPES.YES_NO : ANSWER_TYPES.CATEGORY,
    labels: yesNo ? YES_NO_LABELS : labels,
    definitions: {},
  };
}

/**
 * A past Instant eval run as the runs endpoint returns it. Its questions are
 * matched back to their saved evaluators by config id (labels, definitions,
 * template), which is all its results need to be rebuilt. `rows` is how many
 * rows the task named: sessions, for a user question.
 */
export function historyRun(run, configsById = {}) {
  const items = (run.config_ids || []).map(
    (configId, index) =>
      configsById[configId] ||
      fallbackItem(
        configId,
        run.questions?.[index] || "",
        run.counts?.[configId],
      ),
  );
  return {
    taskId: run.task_id,
    name: run.name || "",
    status: run.status,
    createdAt: run.created_at,
    unit: run.unit,
    reads: run.reads,
    rows: typeof run.rows === "number" && run.rows > 0 ? run.rows : null,
    items,
    counts: run.counts || {},
    answered: run.answered || 0,
    pending: run.pending || 0,
  };
}

/**
 * Past Instant eval runs of this project and view, newest first, page by page,
 * each with its answer split. `search` matches the run's question.
 */
export function useInstantEvalHistory(
  projectId,
  configsById,
  { enabled = true, unit, search = "" } = {},
) {
  const query = useInfiniteQuery({
    queryKey: ["instant-eval-history", projectId, unit || "", search],
    enabled: Boolean(projectId) && enabled,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const response = await axios.get(endpoints.project.instantEvalRuns(), {
        params: {
          project_id: projectId,
          ...(unit ? { unit } : {}),
          ...(search ? { search } : {}),
          page_number: pageParam,
          page_size: HISTORY_PAGE_SIZE,
        },
        signal,
      });
      const data = result(response) || {};
      return {
        page: pageParam,
        runs: data.runs || [],
        hasMore: Boolean(data.has_more),
      };
    },
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    staleTime: 10_000,
    refetchInterval: (current) =>
      current.state.data?.pages.some((page) => page.runs.some(isLiveRun))
        ? HISTORY_LIVE_MS
        : false,
  });
  const runs = useMemo(
    () =>
      (query.data?.pages || [])
        .flatMap((page) => page.runs)
        // Live tasks ("Keep answering") share the name; History lists runs.
        .filter((run) => (run.run_type || "historical") === "historical")
        .map((run) => historyRun(run, configsById)),
    [query.data, configsById],
  );
  return {
    runs,
    isLoading: query.isLoading,
    isError: query.isError,
    hasMore: Boolean(query.hasNextPage),
    isFetchingMore: query.isFetchingNextPage,
    loadMore: query.fetchNextPage,
    refetch: query.refetch,
  };
}
