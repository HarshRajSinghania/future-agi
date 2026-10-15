import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios, { endpoints, readQuery } from "src/utils/axios";
import { getSafeActionErrorMessage } from "src/utils/errorUtils";
import {
  MAX_POPULATION,
  collectPopulation,
} from "src/sections/projects/observePopulation";
import { isRunActive } from "./analyseLenses";
import { isFixedScope } from "./analyseScope";

// Reads and writes of the Analyse endpoints. Every response is
// {status, result}; the hooks hand back `result`.

export const analyseKeys = {
  all: ["analyse"],
  configs: (projectId) => ["analyse", "configs", projectId],
  config: (configId) => ["analyse", "config", configId],
  run: (runId) => ["analyse", "run", runId],
  units: (runId, params) => ["analyse", "units", runId, params],
  population: (unit, projectId, filters, limit) => [
    "analyse",
    "population",
    unit,
    projectId,
    JSON.stringify(filters || []),
    limit,
  ],
};

const RUN_POLL_MS = 2000;
const LIST_POLL_MS = 5000;
export const UNITS_PAGE = 50;
const UNITS_MAX_PAGE = 200;

const result = (response) => response?.data?.result;

export const fetchConfigs = async (projectId, signal) =>
  result(
    await readQuery(endpoints.project.analyseConfigs(), {
      params: { project_id: projectId },
      signal,
    }),
  )?.configs || [];

export const fetchConfig = async (configId, signal) =>
  result(
    await readQuery(endpoints.project.analyseConfig(configId), { signal }),
  );

export const fetchRun = async (runId, signal) =>
  result(await readQuery(endpoints.project.analyseRun(runId), { signal }));

export const fetchUnits = async (runId, params = {}, signal) =>
  result(
    await readQuery(endpoints.project.analyseRunUnits(runId), {
      params: Object.fromEntries(
        Object.entries(params).filter(
          ([, value]) => value !== undefined && value !== null && value !== "",
        ),
      ),
      signal,
    }),
  ) || { units: [], total: 0 };

export const startRun = async (body, signal) =>
  result(await axios.post(endpoints.project.analyseRuns(), body, { signal }));

export const patchConfig = async (configId, body) =>
  result(await axios.patch(endpoints.project.analyseConfig(configId), body));

export const deleteConfig = async (configId) =>
  result(await axios.delete(endpoints.project.analyseConfig(configId)));

export const draftConfig = async (body, signal) =>
  result(await axios.post(endpoints.project.analyseDraft(), body, { signal }));

export const previewConfig = async (body, signal) =>
  result(
    await axios.post(endpoints.project.analysePreview(), body, { signal }),
  );

/** Every unit of a category (or of a run), paged at the endpoint's maximum. */
export async function collectRunUnits(runId, params = {}, signal) {
  const units = [];
  for (let offset = 0; ; offset += UNITS_MAX_PAGE) {
    // eslint-disable-next-line no-await-in-loop
    const page = await fetchUnits(
      runId,
      { ...params, offset, limit: UNITS_MAX_PAGE },
      signal,
    );
    units.push(...(page.units || []));
    if (!page.units?.length || units.length >= (page.total || 0)) break;
  }
  return units;
}

export const isAbort = (error) =>
  error?.name === "AbortError" ||
  error?.name === "CanceledError" ||
  error?.transportCode === "ERR_CANCELED" ||
  error?.code === "ERR_CANCELED";

const messageOf = (error) =>
  [error?.message, error?.detail, error?.result, error?.error].find(
    (value) => typeof value === "string" && value.trim(),
  ) || "";

/**
 * What to tell the user when an Analyse call fails. Plan, rate-limit and
 * model-availability messages are written for users and shown as they are;
 * anything else goes through the app's safe-message filter.
 */
export function analyseErrorMessage(error, fallback = "Something went wrong.") {
  const status = Number(error?.statusCode || error?.response?.status);
  const code = error?.code;
  if (status === 402 || code === "CAPABILITY_DENIED")
    return "Analyse isn't available on this plan.";
  const message = messageOf(error).trim();
  const userFacing =
    status === 429 ||
    status === 503 ||
    code === "rate_limited" ||
    code === "analyse_unavailable" ||
    code === "feature_unavailable";
  if (userFacing && message && message.length <= 240 && !/[\r\n]/.test(message))
    return message;
  return getSafeActionErrorMessage(error, fallback);
}

export function useAnalyseConfigs(projectId) {
  return useQuery({
    queryKey: analyseKeys.configs(projectId),
    queryFn: ({ signal }) => fetchConfigs(projectId, signal),
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      (query.state.data || []).some((c) => isRunActive(c.latest_run?.status))
        ? LIST_POLL_MS
        : false,
    meta: { errorHandled: true },
  });
}

export function useAnalyseConfig(configId) {
  return useQuery({
    queryKey: analyseKeys.config(configId),
    queryFn: ({ signal }) => fetchConfig(configId, signal),
    enabled: Boolean(configId),
    refetchInterval: (query) =>
      isRunActive(query.state.data?.latest_run?.status) ? LIST_POLL_MS : false,
    meta: { errorHandled: true },
  });
}

/**
 * A run, polled every two seconds while it works. When it finishes, the
 * report's run list (pager, trend) and the reports home refresh.
 */
export function useAnalyseRun(runId) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: analyseKeys.run(runId),
    queryFn: ({ signal }) => fetchRun(runId, signal),
    enabled: Boolean(runId),
    refetchInterval: (q) =>
      isRunActive(q.state.data?.status) ? RUN_POLL_MS : false,
    refetchOnWindowFocus: false,
    meta: { errorHandled: true },
  });
  const status = query.data?.status;
  const configId = query.data?.config_id;
  const previous = useRef(status);
  useEffect(() => {
    if (isRunActive(previous.current) && status && !isRunActive(status)) {
      if (configId)
        queryClient.invalidateQueries({
          queryKey: analyseKeys.config(configId),
        });
      queryClient.invalidateQueries({ queryKey: ["analyse", "configs"] });
    }
    previous.current = status;
  }, [status, configId, queryClient]);
  return query;
}

export function useRunUnits(runId, params, { enabled = true } = {}) {
  return useQuery({
    queryKey: analyseKeys.units(runId, params),
    queryFn: ({ signal }) => fetchUnits(runId, params, signal),
    enabled: Boolean(runId) && enabled,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData,
    meta: { errorHandled: true },
  });
}

/** One analysed unit by id, for the unit drawer opened from a citation. */
export function useRunUnit(runId, unitId) {
  return useQuery({
    queryKey: analyseKeys.units(runId, { unit_ids: unitId }),
    queryFn: async ({ signal }) =>
      (await fetchUnits(runId, { unit_ids: unitId, limit: 1 }, signal))
        .units?.[0] || null,
    enabled: Boolean(runId && unitId),
    staleTime: 60_000,
    meta: { errorHandled: true },
  });
}

/**
 * How many units a scope holds, plus the first page of them (ids for the
 * draft and preview). Counting reads one page; a run collects up to
 * MAX_POPULATION.
 */
export const COUNT_LIMIT = 500;

export function usePopulationCount({
  unit,
  projectId,
  filters,
  enabled = true,
}) {
  return useQuery({
    queryKey: analyseKeys.population(unit, projectId, filters, COUNT_LIMIT),
    queryFn: ({ signal }) =>
      collectPopulation({
        unit,
        projectId,
        filters,
        limit: COUNT_LIMIT,
        signal,
      }),
    enabled: Boolean(unit && projectId) && enabled,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData,
    retry: false,
    meta: { errorHandled: true },
  });
}

// Whether the project has any sessions, to pick the default unit.
export function useHasSessions(projectId, enabled) {
  return useQuery({
    queryKey: ["analyse", "has-sessions", projectId],
    queryFn: async ({ signal }) =>
      (
        await collectPopulation({
          unit: "sessions",
          projectId,
          filters: [],
          limit: 1,
          signal,
        })
      ).total > 0,
    enabled: Boolean(projectId) && enabled,
    staleTime: 5 * 60_000,
    retry: false,
    meta: { errorHandled: true },
  });
}

export const collectForScope = ({ unit, projectId, scope, signal }) =>
  collectPopulation({
    unit,
    projectId,
    filters: scope?.filters || [],
    limit: MAX_POPULATION,
    signal,
  });

// A handed-over population (fixed scope) cannot be collected again from
// filters, so its rows are kept for this browser session under the report's
// id: "Run again" and "Retry" can then reuse them.
const POPULATION_PREFIX = "analyse-population:";

export function rememberPopulation(configId, population) {
  try {
    globalThis.sessionStorage?.setItem(
      POPULATION_PREFIX + configId,
      JSON.stringify(population),
    );
  } catch {
    // Storage full or unavailable: a rerun then asks for a time window.
  }
}

export function recallPopulation(configId) {
  try {
    const raw = globalThis.sessionStorage?.getItem(
      POPULATION_PREFIX + configId,
    );
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Whether a saved scope can be collected again from its filters. A scope
 * without filters ("All") reads the whole project; only a handed-over set
 * cannot be rebuilt.
 */
export const canRecollect = (scope) => !isFixedScope(scope);
