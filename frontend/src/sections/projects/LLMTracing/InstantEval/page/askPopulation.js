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
