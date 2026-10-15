import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios, { endpoints, readQuery } from "src/utils/axios";
import { getSafeActionErrorMessage } from "src/utils/errorUtils";
import {
  INSTANT_EVAL_MODEL,
  answerLabels,
  buildEvalMapping,
  buildTemplatePayload,
} from "./instantEvalPayloads";

const POLL_MS = 2000;
// A run that hasn't finished after this long is shown as stalled rather than
// polled forever (a paused or stuck task never reaches a terminal status).
const MAX_FOLLOW_MS = 30 * 60 * 1000;
const POLL_RETRIES = 5;
// Results reach ClickHouse through CDC a few seconds after the task finishes.
const COUNT_SETTLE_ATTEMPTS = 6;
const TERMINAL_TASK_STATUSES = new Set([
  "completed",
  "failed",
  "deleted",
  "paused",
]);
const storageKey = (projectId) => `instant-eval-run:${projectId}`;

const IDLE = { phase: "idle", items: [], counts: {}, traces: [] };

const result = (response) => response?.data?.result;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readStored = (projectId) => {
  try {
    const raw = globalThis.sessionStorage?.getItem(storageKey(projectId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeStored = (projectId, value) => {
  try {
    if (value)
      globalThis.sessionStorage?.setItem(
        storageKey(projectId),
        JSON.stringify(value),
      );
    else globalThis.sessionStorage?.removeItem(storageKey(projectId));
  } catch {
    // Session storage unavailable: the run still completes server-side.
  }
};

// The grid's scope filters carry the date window as a created_at "between"
// item; eval tasks take it as a sibling date_range instead.
export function splitScopeFilters(scopeFilters = []) {
  let dateRange;
  const filters = [];
  scopeFilters.forEach((item) => {
    const config = item?.filter_config || {};
    if (
      item?.column_id === "created_at" &&
      config.filter_op === "between" &&
      Array.isArray(config.filter_value)
    ) {
      dateRange = config.filter_value;
    } else if (item) {
      filters.push(item);
    }
  });
  return { dateRange, filters };
}

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
    reads: meta.reads,
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

async function listProjectConfigs(projectId) {
  const response = await axios.get(endpoints.project.getEvalTaskConfig(), {
    params: { project_id: projectId },
  });
  return result(response) || [];
}

// Asking a question that already has an evaluator in this project (same
// wording, answers and inputs) reuses it, so its grid column and history stay
// one series. Only new questions create a Jev template and an eval config.
async function resolveEvaluators({ projectId, questions, reads }) {
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
      const reuse = existing.find(
        (item) =>
          item.question.toLowerCase() === text.toLowerCase() &&
          item.answerType === question.answerType &&
          item.reads === reads &&
          sameLabels(item.labels, labels),
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
              reads,
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
        reads,
      };
    }),
  );
}

async function createTask({ projectId, items, limit, scopeFilters }) {
  const { dateRange, filters } = splitScopeFilters(scopeFilters);
  const response = await axios.post(endpoints.project.createEvalTask(), {
    name: `Instant eval · ${items[0].question}`.slice(0, 255),
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
  });
  return result(response)?.id;
}

// Same evaluators, same view filters, no date window: answers every new trace
// that matches this view as it arrives.
export async function createContinuousTask({ projectId, items, scopeFilters }) {
  const { filters } = splitScopeFilters(scopeFilters);
  const response = await axios.post(endpoints.project.createEvalTask(), {
    name: `Instant eval (live) · ${items[0].question}`.slice(0, 255),
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

// One live task per set of questions: re-creating it would answer every new
// trace twice and bill twice.
export async function findContinuousTask({ projectId, items }) {
  const response = await axios.get(endpoints.project.getEvalTaskList(), {
    params: { project_id: projectId, page_size: 50 },
  });
  const wanted = new Set(items.map((item) => item.name).filter(Boolean));
  return (result(response)?.table || []).find(
    (task) =>
      task.run_type === "continuous" &&
      !["deleted", "failed"].includes(task.status) &&
      (task.evals_applied || []).length === wanted.size &&
      (task.evals_applied || []).every((name) => wanted.has(name)),
  );
}

// The newest `limit` traces in the scope are exactly the rows the historical
// task evaluates (both read newest-first through the same list builder), and
// each row carries every eval column of the project. One read therefore gives
// the run's trace set with timestamps and the current answer per question.
const MAX_ROWS = 500;

// Plain-language reasons for the task's error groups (normalized messages
// from get_eval_task_logs). Unknown reasons fall back to a generic line.
export function explainErrorGroups(groups = []) {
  return groups.map((group) => {
    const text = `${group?.normalized || ""}`;
    const count = group?.count || 0;
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
    if (/JEV_RATE_LIMITED|JEV_TIMEOUT|JEV_PROVIDER_ERROR/i.test(text))
      return {
        count,
        reason: "failed while calling Jev. Rerun to retry them.",
      };
    if (/missing|not found|Required attribute/i.test(text))
      return { count, reason: "had no input or output for Jev to read." };
    return { count, reason: "couldn't be evaluated." };
  });
}

export function answerFromCell(cell) {
  if (!cell || typeof cell !== "object") return undefined;
  if (cell.error) return "error";
  const label = Object.keys(cell).find(
    (key) => typeof cell[key] === "number" && cell[key] > 0,
  );
  return label;
}

async function fetchRunRows({ projectId, scopeFilters, limit }) {
  const response = await readQuery(
    endpoints.project.getTracesForObserveProject(),
    {
      params: {
        project_id: projectId,
        page_number: 0,
        page_size: Math.min(limit || MAX_ROWS, MAX_ROWS),
        filters: JSON.stringify(scopeFilters),
      },
    },
  );
  return result(response)?.table || [];
}

export function summarizeRows(rows, items) {
  const traces = rows
    .map((row) => ({
      traceId: row.trace_id,
      time: row.start_time || row.created_at,
      input: typeof row.input === "string" ? row.input : "",
      answers: Object.fromEntries(
        items.map((item) => [
          item.configId,
          answerFromCell(row[item.configId]),
        ]),
      ),
    }))
    .sort((a, b) => new Date(a.time) - new Date(b.time));
  const counts = Object.fromEntries(
    items.map((item) => {
      const tally = Object.fromEntries(item.labels.map((label) => [label, 0]));
      let errors = 0;
      traces.forEach((trace) => {
        const answer = trace.answers[item.configId];
        if (answer === "error") errors += 1;
        else if (answer in tally) tally[answer] += 1;
      });
      return [item.configId, { ...tally, __errors: errors }];
    }),
  );
  return { traces, counts };
}

const answeredCount = (traces, items) =>
  traces.filter((trace) =>
    items.every((item) => trace.answers[item.configId] !== undefined),
  ).length;

export function useInstantEvalRun(projectId) {
  const [run, setRun] = useState(IDLE);
  const cancelled = useRef(false);
  const active = useRef(null);

  const update = useCallback(
    (patch) =>
      setRun((prev) => {
        const next = { ...prev, ...patch };
        if (next.taskId && next.phase === "running")
          writeStored(projectId, {
            taskId: next.taskId,
            items: next.items,
            scopeFilters: next.scopeFilters,
            limit: next.limit,
            startedAt: next.startedAt,
          });
        return next;
      }),
    [projectId],
  );

  const follow = useCallback(
    async ({ taskId, items, scopeFilters, limit, startedAt }) => {
      active.current = taskId;
      const isCurrent = () => !cancelled.current && active.current === taskId;
      let progress = {};
      let terminal = false;
      let stalled = false;
      let settleAttempts = 0;
      const deadline = Date.now() + MAX_FOLLOW_MS;
      while (isCurrent()) {
        if (Date.now() > deadline) {
          stalled = true;
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        const [nextProgress, rows] = await Promise.all([
          fetchProgress(taskId),
          fetchRunRows({ projectId, scopeFilters, limit }).catch(() => null),
        ]);
        if (!isCurrent()) return;
        progress = nextProgress;
        const perQuestion = items.length || 1;
        const patch = {
          taskStatus: progress.status,
          errorGroups: progress.error_groups || [],
          total: Math.round((progress.total_count || 0) / perQuestion),
          completed: Math.round((progress.success_count || 0) / perQuestion),
          failed: Math.round(
            ((progress.errors_count || 0) + (progress.skipped_count || 0)) /
              perQuestion,
          ),
        };
        if (rows) Object.assign(patch, summarizeRows(rows, items));
        update(patch);
        terminal = TERMINAL_TASK_STATUSES.has(progress.status);
        // Answers reach ClickHouse through CDC a few seconds after the task
        // finishes; keep reading until every finished trace shows its answer.
        // Skipped traces never get an answer, so they are not waited for.
        const expectedAnswers = Math.round(
          ((progress.success_count || 0) + (progress.errors_count || 0)) /
            perQuestion,
        );
        const settled =
          rows &&
          answeredCount(summarizeRows(rows, items).traces, items) >=
            expectedAnswers;
        if (terminal && (settled || settleAttempts >= COUNT_SETTLE_ATTEMPTS))
          break;
        if (terminal) settleAttempts += 1;
        // eslint-disable-next-line no-await-in-loop
        await sleep(POLL_MS);
      }
      if (!isCurrent()) return;
      writeStored(projectId, null);
      update({
        phase: "done",
        finishedAt: new Date().toISOString(),
        startedAt,
        error: stalled
          ? "This run is taking unusually long. Its answers will keep appearing in the Trace view as they finish."
          : progress.status === "paused"
            ? "This run was paused before every trace was answered."
            : progress.status === "failed"
              ? "The run stopped before every trace was answered."
              : undefined,
      });
    },
    [projectId, update],
  );

  const launch = useCallback(
    async ({ questions, existingItems, reads, limit, scope }) => {
      cancelled.current = false;
      const scopeFilters = scope?.scopeFilters || [];
      const pending =
        existingItems ||
        questions.map((q) => ({
          question: q.question.trim(),
          answerType: q.answerType,
          labels: answerLabels(q),
        }));
      const startedAt = new Date().toISOString();
      setRun({
        ...IDLE,
        phase: "creating",
        items: pending,
        scopeFilters,
        limit,
        startedAt,
        since: scope?.since,
      });
      try {
        const items =
          existingItems ||
          (await resolveEvaluators({ projectId, questions, reads }));
        if (items.some((item) => !item.configId))
          throw new Error("The evaluator could not be saved.");
        const taskId = await createTask({
          projectId,
          items,
          limit,
          scopeFilters,
        });
        if (!taskId) throw new Error("The run could not be started.");
        update({ phase: "running", items, taskId, scopeFilters });
        await follow({ taskId, items, scopeFilters, limit, startedAt });
      } catch (error) {
        if (cancelled.current) return;
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
    [projectId, follow, update],
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

  // Open a past run from History: its evaluators, its stored scope.
  const view = useCallback(
    ({ taskId, items, scopeFilters, limit, startedAt }) => {
      cancelled.current = false;
      setRun({
        ...IDLE,
        phase: "running",
        items,
        taskId,
        scopeFilters,
        limit,
        startedAt,
        viewing: true,
      });
      follow({ taskId, items, scopeFilters, limit, startedAt }).catch(() =>
        setRun((prev) => ({
          ...prev,
          phase: "failed",
          error: "This run could not be loaded.",
        })),
      );
    },
    [follow],
  );

  const reset = useCallback(() => {
    active.current = null;
    writeStored(projectId, null);
    setRun(IDLE);
  }, [projectId]);

  // Resume a run that was in flight when the panel or page was closed.
  useEffect(() => {
    // A new project starts clean: stop following the previous project's run.
    active.current = null;
    setRun(IDLE);
    cancelled.current = false;
    const stored = projectId ? readStored(projectId) : null;
    if (stored?.taskId) {
      setRun({
        ...IDLE,
        phase: "running",
        items: stored.items || [],
        taskId: stored.taskId,
        scopeFilters: stored.scopeFilters || [],
        limit: stored.limit,
        startedAt: stored.startedAt,
      });
      follow(stored).catch(() => writeStored(projectId, null));
    }
    return () => {
      cancelled.current = true;
    };
  }, [projectId, follow]);

  return { run, start, rerun, view, reset };
}

export function useInstantEvals(projectId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: ["instant-evals", projectId],
    enabled: Boolean(projectId) && enabled,
    queryFn: () =>
      axios.get(endpoints.project.getEvalTaskConfig(), {
        params: { project_id: projectId },
      }),
    select: (response) => {
      const configs = result(response) || [];
      const seen = new Set();
      const all = configs.map(itemFromConfig).filter(Boolean).reverse();
      return {
        all,
        // One entry per question: re-asking a question creates a new
        // evaluator, and the newest one is the one worth re-applying.
        items: all.filter((item) => {
          const key = item.question.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      };
    },
    staleTime: 30_000,
  });
  return {
    all: query.data?.all || [],
    items: query.data?.items || [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

const INSTANT_EVAL_TASK_PREFIX = "Instant eval";

// Past runs are the project's historical eval tasks created by Instant eval.
// Their evaluators are matched back to saved questions by config name.
export function useInstantEvalHistory(
  projectId,
  configsByName,
  { enabled = true } = {},
) {
  const query = useQuery({
    queryKey: ["instant-eval-history", projectId],
    enabled: Boolean(projectId) && enabled,
    queryFn: () =>
      axios.get(endpoints.project.getEvalTaskList(), {
        params: {
          project_id: projectId,
          name: INSTANT_EVAL_TASK_PREFIX,
          page_size: 50,
        },
      }),
    select: (response) => result(response)?.table || [],
    refetchInterval: 15_000,
  });
  const runs = (query.data || [])
    .filter(
      (task) =>
        task.run_type === "historical" &&
        task.name?.startsWith(INSTANT_EVAL_TASK_PREFIX),
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
        scopeFilters,
      };
    })
    .filter((runItem) => runItem.items.length > 0)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { runs, isLoading: query.isLoading, refetch: query.refetch };
}
