import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDebounce } from "src/hooks/use-debounce";
import {
  MAX_POPULATION,
  collectPopulation,
} from "src/sections/projects/observePopulation";
import {
  datePresetOf,
  scopeApiFilters,
} from "src/sections/projects/observeScope";
import { estimateAsk } from "../useInstantEval";

// What a new question is about, as the server counts it: the view's rows
// (its filters and date window), or exactly the rows handed over by id.
// The count comes with what reading a sample or every row would cost.

// Ids a hand-over may name; past this a view hands over its filters instead.
export const MAX_HANDOVER = 5000;
const CREDITS_PER_ANSWER = 0.06;
// Edits to the date or filters settle this long before the count is asked
// for again, so picking several values reads once.
export const SCOPE_SETTLE_MS = 300;
// A Users count that checks each user is counted a few seconds at a time:
// until it is exact, it is read again this often and shown as "N+".
export const COUNTING_POLL_MS = 2000;

/** The rows handed over by id, if any. */
export function handedIds(seed) {
  if (Array.isArray(seed?.population) && seed.population.length)
    return seed.population
      .filter((item) => item?.id)
      .map((item) => String(item.id));
  if (Array.isArray(seed?.ids) && seed.ids.length)
    return seed.ids.filter(Boolean).map(String);
  return null;
}

/** The sample sizes worth offering for a view of `count` rows. */
export const sampleSizes = (estimate) =>
  (estimate?.choices || [])
    .filter((choice) => choice.sample_size != null)
    .map((choice) => choice.sample_size);

/** The default choice: a sample of 1,000 above 1,000 rows, else every row. */
export const defaultChoice = (estimate) =>
  estimate?.default_sample_size ? estimate.default_sample_size : null;

/** The fixed sizes, plus the largest sample the credits left pay for. */
export function offeredSizes(estimate, questions = 1) {
  const count = estimate?.population ?? 0;
  const fits = choiceCost(estimate, null, questions)?.fitsSize;
  const sizes = [...sampleSizes(estimate)];
  if (fits > 0 && fits < count && !sizes.includes(fits)) {
    sizes.push(fits);
    sizes.sort((a, b) => a - b);
  }
  return sizes;
}

/**
 * One choice's cost for `questions` questions: rows read, credits, time,
 * whether it needs a confirm and whether the server would take it at all.
 */
export function choiceCost(estimate, size, questions = 1) {
  if (!estimate) return null;
  const choices = estimate.choices || [];
  const all = choices.find((item) => item.sample_size == null);
  let choice = choices.find((item) => item.sample_size === size) || all;
  if (!choice) return null;
  const perUnit = estimate.sessions_per_user || 1;
  if (size != null && choice === all && all.rows_to_read) {
    // A size the server didn't cost (the largest sample the credits
    // fit): scaled from reading every row.
    const rows = Math.min(size, estimate.population) * perUnit;
    choice = {
      rows_to_read: rows,
      seconds_estimate:
        10 +
        Math.round(((all.seconds_estimate - 10) * rows) / all.rows_to_read),
    };
  }
  const rows = choice.rows_to_read;
  const q = Math.max(1, questions);
  const credits = rows * q * CREDITS_PER_ANSWER;
  // The credits left this month (null: no cap this view can reach), and
  // whether billing stops every run (a paused budget, an unpaid invoice).
  const check = estimate.credit_check || {};
  const creditsLeft = check.credits_left ?? null;
  const blocked = Boolean(check.blocked);
  const creditLimited =
    blocked || (creditsLeft != null && credits > creditsLeft + 1e-9);
  return {
    size,
    rows,
    credits,
    // The server's estimate is for one question; each adds its reads.
    seconds: 10 + Math.max(0, choice.seconds_estimate - 10) * q,
    needsConfirm: rows > estimate.confirm_rows,
    creditLimited,
    creditsLeft,
    blocked,
    // The largest sample the credits left pay for, in the view's unit.
    fitsSize:
      creditsLeft == null || blocked
        ? null
        : Math.min(
            estimate.population,
            Math.floor(
              (creditsLeft + 1e-9) / (q * CREDITS_PER_ANSWER * perUnit),
            ),
          ),
    allowed: rows > 0 && rows <= estimate.max_rows && !creditLimited,
  };
}

/**
 * The scope of a new question: the server's count and estimate for the
 * scope's rows (its filters and date window), or for exactly the rows handed
 * over. Edits settle before the count is read again, and the last count stays
 * on screen while the next one is read. When the server can't read the
 * filters, the page collects the newest rows itself and hands them over.
 */
export function useAskScope({ projectId, unit, scope }) {
  const handed = useMemo(
    () => (scope?.ids?.length ? scope.ids.map(String) : null),
    [scope?.ids],
  );
  // Users handed over are read inside the view's window, so its filters ride
  // along with their ids; other rows named by id need none.
  const users = unit === "users";
  // What a start sends too, so the count is for exactly that request.
  const read = useMemo(
    () => ({
      filters: handed && !users ? [] : scopeApiFilters(scope),
      search: users && !handed ? scope?.search || undefined : undefined,
      datePreset: handed ? undefined : datePresetOf(scope?.dateOption),
      label: scope?.label || undefined,
    }),
    [handed, users, scope],
  );
  const readKey = JSON.stringify(read);
  const settledKey = useDebounce(readKey, SCOPE_SETTLE_MS);
  const settled = useMemo(() => JSON.parse(settledKey), [settledKey]);
  const { filters, search, datePreset, label } = settled;
  const query = useQuery({
    queryKey: [
      "ask-estimate",
      projectId,
      unit,
      handed ? handed.length : "",
      settledKey,
    ],
    enabled: Boolean(projectId),
    queryFn: async ({ signal }) => {
      try {
        const estimate = await estimateAsk({
          projectId,
          unit,
          filters,
          ids: handed ? handed.slice(0, MAX_HANDOVER) : undefined,
          search,
          datePreset,
          label,
          signal,
        });
        return { estimate, fallbackIds: null };
      } catch (error) {
        if (handed || error?.response?.status !== 422) throw error;
        // Filters the server can't count: read the newest rows the grid shows
        // and ask about exactly those.
        const population = await collectPopulation({
          unit,
          projectId,
          filters,
          limit: MAX_POPULATION,
          signal,
        });
        const ids = population.items.map((item) => item.id);
        const estimate = await estimateAsk({ projectId, unit, ids, signal });
        return {
          estimate: { ...estimate, view_total: population.total },
          fallbackIds: ids,
        };
      }
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchInterval: (current) =>
      users && current.state.data?.estimate?.population_is_lower_bound
        ? COUNTING_POLL_MS
        : false,
    retry: 1,
    meta: { errorHandled: true },
  });
  const ids = handed ? handed.slice(0, MAX_HANDOVER) : query.data?.fallbackIds;
  // The shown count is for the settled filters, which a start then sends.
  const updating = settledKey !== readKey || query.isPlaceholderData;
  const estimate = query.data?.estimate || null;
  return {
    estimate,
    ids: ids || null,
    handedOver: Boolean(handed),
    tooMany: Boolean(handed && handed.length > MAX_HANDOVER),
    fallback: Boolean(query.data?.fallbackIds),
    // Still counting users: a start needn't wait, it counts them all.
    counting: users && Boolean(estimate?.population_is_lower_bound),
    filters,
    search,
    datePreset,
    label,
    isLoading: query.isLoading,
    isUpdating: updating,
    isError: query.isError,
    refetch: query.refetch,
  };
}
