import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MAX_POPULATION,
  collectPopulation,
} from "src/sections/projects/observePopulation";
import { estimateAsk } from "../useInstantEval";

// What a new question is about, as the server counts it: the view's rows
// (its filters and date window), or exactly the rows handed over by id.
// The count comes with what reading a sample or every row would cost.

// Ids a hand-over may name; past this a view hands over its filters instead.
export const MAX_HANDOVER = 5000;
const CREDITS_PER_ANSWER = 0.06;

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

/**
 * One choice's cost for `questions` questions: rows read, credits, time,
 * whether it needs a confirm and whether the server would take it at all.
 */
export function choiceCost(estimate, size, questions = 1) {
  if (!estimate) return null;
  const choice =
    (estimate.choices || []).find((item) => item.sample_size === size) ||
    (estimate.choices || []).find((item) => item.sample_size == null);
  if (!choice) return null;
  const rows = choice.rows_to_read;
  const q = Math.max(1, questions);
  // The answers the plan has left: the estimate's row allowance times the
  // questions it was asked for.
  const answersLeft =
    estimate.quota_max_rows == null
      ? null
      : estimate.quota_max_rows * Math.max(1, estimate.questions || 1);
  const quotaLimited = answersLeft != null && rows * q > answersLeft;
  return {
    size,
    rows,
    credits: rows * q * CREDITS_PER_ANSWER,
    // The server's estimate is for one question; each adds its reads.
    seconds: 10 + Math.max(0, choice.seconds_estimate - 10) * q,
    needsConfirm: rows > estimate.confirm_rows,
    // More Jev answers than the plan has left today or this month.
    quotaLimited,
    fitsRows: answersLeft == null ? null : Math.floor(answersLeft / q),
    allowed: rows > 0 && rows <= estimate.max_rows && !quotaLimited,
  };
}

/**
 * The scope of a new question: the server's count and estimate for the
 * view (or the hand-over). When the server can't read the view's filters,
 * the page collects the newest rows itself and hands them over.
 */
export function useAskScope({ projectId, unit, seed }) {
  const handed = useMemo(() => handedIds(seed), [seed]);
  const filters = useMemo(() => seed?.filters || [], [seed]);
  const query = useQuery({
    queryKey: [
      "ask-estimate",
      projectId,
      unit,
      handed ? handed.length : JSON.stringify(filters),
    ],
    enabled: Boolean(projectId),
    queryFn: async ({ signal }) => {
      try {
        const estimate = await estimateAsk({
          projectId,
          unit,
          filters: handed ? [] : filters,
          ids: handed ? handed.slice(0, MAX_HANDOVER) : undefined,
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
    staleTime: 60_000,
    retry: 1,
    meta: { errorHandled: true },
  });
  const ids = handed ? handed.slice(0, MAX_HANDOVER) : query.data?.fallbackIds;
  return {
    estimate: query.data?.estimate || null,
    ids: ids || null,
    handedOver: Boolean(handed),
    tooMany: Boolean(handed && handed.length > MAX_HANDOVER),
    fallback: Boolean(query.data?.fallbackIds),
    filters,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
