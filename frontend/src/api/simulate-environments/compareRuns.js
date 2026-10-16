import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import axios from "src/utils/axios";
import { apiPath } from "src/api/contracts/api-surface";
import { listRunTestExecutions, mapExecutions } from "./runs";
import { compareRunsKeyPrefix } from "./runEvals";

/**
 * Two runs of one environment, scenario by scenario. Without `againstId` the
 * server compares with the previous completed run and names it in the answer
 * (`against_execution_id`, null when there is none). Not gated on versioning:
 * runs from before versioning compare too, with null versions.
 */

const comparePath = (envId) =>
  apiPath("/simulate/api/harness-environments/{id}/compare/", { id: envId });

export const getRunComparison = async (envId, executionId, againstId) =>
  (
    await axios.get(comparePath(envId), {
      params: {
        execution_id: executionId,
        ...(againstId ? { against_execution_id: againstId } : {}),
      },
    })
  ).data;

export const compareRunsKey = (envId, executionId, againstId) => [
  ...compareRunsKeyPrefix,
  envId,
  executionId,
  againstId || null,
];

const errorStatus = (error) => error?.statusCode ?? error?.response?.status;
// A refused comparison answers the same way every time; only a server or
// network failure is worth asking again.
const retryServerFailures = (failureCount, error) => {
  const status = errorStatus(error);
  return (status === undefined || status >= 500) && failureCount < 2;
};

export function useCompareRuns(
  envId,
  executionId,
  againstId,
  { enabled = true } = {},
) {
  return useQuery({
    queryKey: compareRunsKey(envId, executionId, againstId),
    queryFn: () => getRunComparison(envId, executionId, againstId),
    enabled: Boolean(envId && executionId) && enabled,
    retry: retryServerFailures,
    staleTime: 1000 * 60 * 5,
    meta: { errorHandled: true },
  });
}

const FINISHED_RUNS_PAGE = 50;

/**
 * The runs a comparison can be made against: the environment's completed runs,
 * newest first, read a page at a time as summaries (no call counts). A finished
 * run doesn't change, so the list is not polled.
 */
export function useFinishedRuns(env, { enabled = true } = {}) {
  const runTestId = env?.platform?.runTestId;
  const query = useInfiniteQuery({
    queryKey: ["run-test-executions", runTestId, "finished"],
    queryFn: ({ pageParam }) =>
      listRunTestExecutions(runTestId, {
        page: pageParam + 1,
        limit: FINISHED_RUNS_PAGE,
        summary: true,
      }).then((payload) => ({
        runs: mapExecutions(payload, pageParam * FINISHED_RUNS_PAGE),
        count: payload?.count ?? 0,
      })),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      pages.length * FINISHED_RUNS_PAGE < last.count ? pages.length : undefined,
    enabled: Boolean(runTestId) && enabled,
    staleTime: 1000 * 60,
  });
  const seen = new Set();
  const runs = (query.data?.pages ?? [])
    .flatMap((page) => page.runs)
    .filter((run) => {
      // A run started while paging shifts the pages by one.
      if (seen.has(run.executionId)) return false;
      seen.add(run.executionId);
      return run.runState === "finished";
    });
  return {
    runs,
    hasMore: Boolean(query.hasNextPage),
    loadMore: () => query.fetchNextPage(),
    isLoadingMore: query.isFetchingNextPage,
    // A failed list read again counts as loading, not as failed.
    isLoading: query.isFetching && !query.data,
    isFetched: query.isFetched,
    isError: query.isError && !query.isFetching,
    refetch: () => query.refetch(),
  };
}
