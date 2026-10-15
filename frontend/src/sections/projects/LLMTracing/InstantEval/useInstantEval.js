import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios, { endpoints, readQuery } from "src/utils/axios";
import { getSafeActionErrorMessage } from "src/utils/errorUtils";
import { collectPopulation } from "src/sections/projects/observePopulation";
import {
  INSTANT_EVAL_MODEL,
  answerLabels,
  buildEvalMapping,
  buildTemplatePayload,
  cleanDefinitions,
} from "./instantEvalPayloads";
import {
  TASK_PREFIX,
  endUserIds,
  normalizeReads,
  progressCounts,
  sessionIdsFromUserSessions,
  sessionsTaskPayload,
  splitScopeFilters,
  traceIdsFilter,
  tracesTaskPayload,
  unitMeta,
  userSessionsRequest,
} from "./instantEvalUnits";
import {
  EMPTY_ANSWERS,
  ERROR_ANSWER,
  answeredCount,
  normalizeAnswers,
  traceMetrics,
} from "./instantEvalAnswers";

export { ERROR_ANSWER };

const POLL_MS = 2000;
// A run that hasn't finished after this long is shown as stalled rather than
// polled forever (a paused or stuck task never reaches a terminal status).
const MAX_FOLLOW_MS = 30 * 60 * 1000;
const POLL_RETRIES = 5;
// Answers land a few seconds after the task finishes.
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
 * The rows a run asks about. Traces are chosen by the task from the view's
 * filters; sessions are the exact session ids in view; users are each user's
 * latest sessions in the view's window.
 */
async function collectTarget({ projectId, unit, limit, scope }) {
  const handedOver = scope?.handedOver;
  const filters = scope?.filters || [];
  if (unit === "traces") {
    if (handedOver)
      return {
        scopeFilters: [traceIdsFilter(handedOver.ids.slice(0, limit))],
        limit: Math.min(limit, handedOver.ids.length),
      };
    return { scopeFilters: filters, limit };
  }
  const population = handedOver
    ? null
    : await collectPopulation({ unit, projectId, filters, limit });
  const ids = handedOver
    ? handedOver.ids.slice(0, limit)
    : population.items.map((item) => item.id);
  if (unit === "sessions") {
    if (!ids.length)
      return { empty: "There are no sessions in this view to ask about." };
    return { sessionIds: ids, asked: { sessions: ids.length } };
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
  const sessionIds = sessionIdsFromUserSessions(result(response));
  if (!sessionIds.length)
    return { empty: "None of these users had a session in this window." };
  return {
    sessionIds,
    asked: {
      users: result(response)?.users ?? userIds.length,
      sessions: sessionIds.length,
    },
  };
}

async function createTask({ projectId, unit, items, target }) {
  const payload =
    unit === "traces"
      ? tracesTaskPayload({
          projectId,
          items,
          limit: target.limit,
          scopeFilters: target.scopeFilters,
        })
      : sessionsTaskPayload({
          projectId,
          items,
          sessionIds: target.sessionIds,
        });
  const response = await axios.post(
    endpoints.project.createEvalTask(),
    payload,
  );
  return result(response)?.id;
}

const LIVE_TASK_PREFIX = "Instant eval (live)";
const LIVE_TASK_PAGE_SIZE = 50;
const LIVE_TASK_MAX_PAGES = 20;

// Same evaluators, same view filters, no date window: answers every new trace
// that matches this view as it arrives.
export async function createContinuousTask({ projectId, items, scopeFilters }) {
  const { filters } = splitScopeFilters(scopeFilters);
  const response = await axios.post(endpoints.project.createEvalTask(), {
    name: `${LIVE_TASK_PREFIX} · ${items[0].question}`.slice(0, 255),
    project: projectId,
    evals: items.map((item) => item.configId),
    filters: filters.length ? { filters } : {},
    run_type: "continuous",
    row_type: "traces",
    sampling_rate: 100,
  });
  return result(response)?.id;
}

async function fetchProgress(taskId) {
  let lastError;
  for (let attempt = 0; attempt < POLL_RETRIES; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await axios.get(endpoints.project.getEvalTaskLogs(), {
        params: { eval_task_id: taskId },
      });
      return result(response) || {};
    } catch (error) {
      // A dropped poll should not end the run on screen; the task keeps
      // running server-side.
      lastError = error;
      // eslint-disable-next-line no-await-in-loop
      await sleep(POLL_MS * (attempt + 1));
    }
  }
  throw lastError;
}

async function fetchAnswers({ projectId, taskId, unit, items }) {
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

// Latency, cost and status of a trace run's rows: the newest `limit` traces in
// the scope are exactly the rows the historical task evaluated.
async function fetchTraceMetrics({ projectId, scopeFilters, limit }) {
  const response = await readQuery(
    endpoints.project.getTracesForObserveProject(),
    {
      params: {
        project_id: projectId,
        page_number: 0,
        page_size: Math.min(limit || MAX_METRIC_ROWS, MAX_METRIC_ROWS),
        filters: JSON.stringify(scopeFilters || []),
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

function endMessage({ stalled, status, unit }) {
  const noun = unitMeta(unit).noun;
  if (stalled)
    return "This run is taking unusually long. Jev keeps answering in the background; reopen Instant eval later to see the rest.";
  if (status === "paused")
    return `This run was paused before every ${noun} was answered.`;
  if (status === "failed")
    return `The run stopped before every ${noun} was answered.`;
  return undefined;
}

/**
 * One Instant eval run in one view (traces, sessions or users) of a project.
 * The run in flight, or the last one finished, is kept per project and unit in
 * session storage, so closing the drawer or reloading the page picks it up.
 */
export function useInstantEvalRun(projectId, unit = "traces") {
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
      let progress = progressCounts({}, items.length);
      let answers = null;
      let stalled = false;
      let settleAttempts = 0;
      const deadline = Date.now() + MAX_FOLLOW_MS;
      for (let tick = 0; isCurrent(); tick += 1) {
        if (Date.now() > deadline) {
          stalled = true;
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        progress = progressCounts(await fetchProgress(taskId), items.length);
        if (!isCurrent()) return;
        const terminal = TERMINAL_TASK_STATUSES.has(progress.status);
        // Answers are read every other poll while Jev works, and every poll
        // once the task has ended until they have all landed.
        if (terminal || tick % 2 === 0) {
          // eslint-disable-next-line no-await-in-loop
          answers =
            (await fetchAnswers({ projectId, taskId, unit, items }).catch(
              () => null,
            )) || answers;
          if (!isCurrent()) return;
        }
        const snapshot = { progress, ...(answers ? { answers } : {}) };
        setRun((prev) => ({ ...prev, ...snapshot }));
        const settled =
          answers && answeredCount(answers, items, unit) >= progress.expected;
        if (terminal && (settled || settleAttempts >= ANSWER_SETTLE_ATTEMPTS))
          break;
        if (terminal) settleAttempts += 1;
        // eslint-disable-next-line no-await-in-loop
        await sleep(POLL_MS);
      }
      if (!isCurrent()) return;
      const metrics =
        unit === "traces"
          ? await fetchTraceMetrics({
              projectId,
              scopeFilters: base.scopeFilters,
              limit: base.limit || progress.total,
            }).catch(() => null)
          : null;
      if (!isCurrent()) return;
      setRun((prev) => ({
        ...prev,
        phase: "done",
        finishedAt: prev.finishedAt || new Date().toISOString(),
        error: endMessage({ stalled, status: progress.status, unit }),
        ...(answers ? {} : { answers: { ...EMPTY_ANSWERS, loaded: true } }),
        ...(metrics ? { metrics } : {}),
      }));
    },
    [projectId, unit],
  );

  // A finished run reopened from storage: read its answers once.
  const reload = useCallback(
    async (base, mine) => {
      const isCurrent = () => !cancelled.current && generation.current === mine;
      try {
        const [answers, metrics] = await Promise.all([
          fetchAnswers({
            projectId,
            taskId: base.taskId,
            unit,
            items: base.items,
          }),
          unit === "traces"
            ? fetchTraceMetrics({
                projectId,
                scopeFilters: base.scopeFilters,
                limit: base.limit,
              }).catch(() => null)
            : null,
        ]);
        if (!isCurrent()) return;
        setRun((prev) => ({
          ...prev,
          answers,
          ...(metrics ? { metrics } : {}),
        }));
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
      writeStored(projectId, unit, null);
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
        phase: unit === "traces" ? "creating" : "collecting",
        items: pending,
        limit,
        reads: runReads,
        scopeFilters: scope?.filters || [],
        scopeLabel: scope?.label,
        handedOver: scope?.handedOver || null,
        startedAt: new Date().toISOString(),
      });
      try {
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
          asked: target.asked || null,
          scopeFilters: target.scopeFilters || prev.scopeFilters,
        }));
        const items =
          existingItems ||
          (await resolveEvaluators({
            projectId,
            questions,
            reads: runReads,
            unit,
          }));
        if (stale()) return;
        if (items.some((item) => !item.configId))
          throw new Error("The evaluator could not be saved.");
        const taskId = await createTask({ projectId, unit, items, target });
        if (stale()) return;
        if (!taskId) throw new Error("The run could not be started.");
        setRun((prev) => ({ ...prev, phase: "running", items, taskId }));
        await follow(
          {
            taskId,
            items,
            scopeFilters: target.scopeFilters,
            limit: target.limit,
          },
          mine,
        );
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
    [projectId, unit, follow],
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
    ({ taskId, items, scopeFilters, startedAt }) => {
      generation.current += 1;
      const mine = generation.current;
      cancelled.current = false;
      setRun({
        ...IDLE,
        phase: "running",
        items,
        taskId,
        scopeFilters,
        startedAt,
        viewing: true,
      });
      follow({ taskId, items, scopeFilters }, mine).catch(() => {
        if (generation.current !== mine) return;
        setRun((prev) => ({
          ...prev,
          phase: "failed",
          error: "This run could not be loaded.",
        }));
      });
    },
    [follow],
  );

  const reset = useCallback(() => {
    generation.current += 1;
    writeStored(projectId, unit, null);
    setRun(IDLE);
  }, [projectId, unit]);

  // Keep the run in flight (or the last one finished) for this project+unit.
  useEffect(() => {
    if (!projectId || !run.taskId) return;
    if (run.phase === "running" || run.phase === "done")
      writeStored(projectId, unit, storable(run));
  }, [projectId, unit, run]);

  // Resume the run that was in flight, or show the last one finished, when the
  // drawer or page opens again.
  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    cancelled.current = false;
    const stored = projectId ? readStored(projectId, unit) : null;
    if (!stored?.taskId || !Array.isArray(stored.items)) {
      setRun(IDLE);
    } else {
      const base = { ...IDLE, ...stored, answers: EMPTY_ANSWERS };
      if (stored.phase === "done") {
        setRun({ ...base, phase: "done" });
        reload(base, mine);
      } else {
        setRun({ ...base, phase: "running" });
        follow(base, mine).catch(() => {
          if (generation.current !== mine) return;
          writeStored(projectId, unit, null);
          setRun((prev) => ({
            ...prev,
            phase: "failed",
            error:
              "The run that was in progress could not be resumed. Jev keeps answering in the background.",
          }));
        });
      }
    }
    return () => {
      cancelled.current = true;
    };
  }, [projectId, unit, follow, reload]);

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

// Past runs are the project's historical eval tasks created by Instant eval.
// Their evaluators are matched back to saved questions by config name, which
// also tells which view a run belongs to.
export function useInstantEvalHistory(
  projectId,
  configsByName,
  { enabled = true, unit } = {},
) {
  const query = useQuery({
    queryKey: ["instant-eval-history", projectId],
    enabled: Boolean(projectId) && enabled,
    queryFn: () =>
      axios.get(endpoints.project.getEvalTaskList(), {
        params: {
          project_id: projectId,
          name: TASK_PREFIX,
          page_size: 50,
        },
      }),
    select: (response) => result(response)?.table || [],
    refetchInterval: 15_000,
  });
  const runs = (query.data || [])
    .filter(
      (task) =>
        task.run_type === "historical" && task.name?.startsWith(TASK_PREFIX),
    )
    .map((task) => {
      const items = (task.evals_applied || [])
        .map((name) => configsByName?.[name])
        .filter(Boolean);
      const range = task.filters_applied?.date_range;
      const scopeFilters = [
        ...(task.filters_applied?.filters || []),
        ...(range
          ? [
              {
                column_id: "created_at",
                filter_config: {
                  filter_type: "datetime",
                  filter_op: "between",
                  filter_value: range,
                },
              },
            ]
          : []),
      ];
      return {
        taskId: task.id,
        status: task.status,
        createdAt: task.created_at,
        dateRange: range,
        filterCount: (task.filters_applied?.filters || []).length,
        items,
        unit: items[0]?.unit || "traces",
        scopeFilters,
      };
    })
    .filter(
      (runItem) => runItem.items.length > 0 && (!unit || runItem.unit === unit),
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { runs, isLoading: query.isLoading, refetch: query.refetch };
}
