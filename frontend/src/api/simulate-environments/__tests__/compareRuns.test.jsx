import { describe, it, expect, vi, beforeEach } from "vitest";
import PropTypes from "prop-types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("src/utils/axios", () => ({
  default: { get: vi.fn() },
  endpoints: {
    runTests: {
      detailExecutions: (id) => `/simulate/run-tests/${id}/executions/`,
    },
  },
}));

const { default: axios } = await import("src/utils/axios");
const { useCompareRuns, useFinishedRuns, compareRunsKey } = await import(
  "../compareRuns"
);
const { compareRunsKeyPrefix } = await import("../runEvals");

let client;
const wrapper = ({ children }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
wrapper.propTypes = { children: PropTypes.node };

const PATH = "/simulate/api/harness-environments/env-1/compare/";
const RESPONSE = {
  execution_id: "run-2",
  against_execution_id: "run-1",
  pairs: [],
  summary: { paired: 0 },
  versions: { current: {}, against: null },
};

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  axios.get.mockReset();
});

describe("useCompareRuns", () => {
  it("asks for the previous run when none is picked", async () => {
    axios.get.mockResolvedValue({ data: RESPONSE });

    const { result } = renderHook(
      () => useCompareRuns("env-1", "run-2", null),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(axios.get).toHaveBeenCalledWith(PATH, {
      params: { execution_id: "run-2" },
    });
    expect(result.current.data).toEqual(RESPONSE);
    expect(client.getQueryData(compareRunsKey("env-1", "run-2"))).toEqual(
      RESPONSE,
    );
    // Refreshed with the run's analytics.
    expect(compareRunsKey("env-1", "run-2").slice(0, 1)).toEqual(
      compareRunsKeyPrefix,
    );
  });

  it("sends the picked run", async () => {
    axios.get.mockResolvedValue({ data: RESPONSE });

    const { result } = renderHook(
      () => useCompareRuns("env-1", "run-2", "run-0"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(axios.get).toHaveBeenCalledWith(PATH, {
      params: { execution_id: "run-2", against_execution_id: "run-0" },
    });
  });

  it("waits for the environment and the run", () => {
    renderHook(() => useCompareRuns(undefined, "run-2", null), { wrapper });
    renderHook(() => useCompareRuns("env-1", undefined, null), { wrapper });

    expect(axios.get).not.toHaveBeenCalled();
  });

  it("does not ask again after a refusal", async () => {
    axios.get.mockRejectedValue({ statusCode: 404 });

    const { result } = renderHook(
      () => useCompareRuns("env-1", "run-2", null),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it("asks again after a server failure", async () => {
    axios.get
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockResolvedValue({ data: RESPONSE });

    const { result } = renderHook(
      () => useCompareRuns("env-1", "run-2", null),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});

describe("useFinishedRuns", () => {
  const ENV = { platform: { runTestId: "rt-1" } };
  const RUNS_PATH = "/simulate/run-tests/rt-1/executions/";
  const execution = (id, status, fields = {}) => ({ id, status, ...fields });

  it("lists only completed runs, labelled with their run number and versions", async () => {
    axios.get.mockResolvedValue({
      data: {
        count: 4,
        results: [
          execution("e4", "Running"),
          execution("e3", "Completed", {
            pinned_agent_version: { id: "a2", label: "v2" },
            suite_version: { id: "s3", label: "v3" },
          }),
          execution("e2", "Failed"),
          execution("e1", "Completed"),
        ],
      },
    });

    const { result } = renderHook(() => useFinishedRuns(ENV), { wrapper });

    await waitFor(() => expect(result.current.runs).toHaveLength(2));
    expect(axios.get).toHaveBeenCalledWith(RUNS_PATH, {
      params: { page: 1, limit: 50, summary: true },
    });
    expect(
      result.current.runs.map(({ executionId, label }) => [executionId, label]),
    ).toEqual([
      ["e3", "Run 3"],
      ["e1", "Run 1"],
    ]);
    expect(result.current.runs[0].pinnedAgentVersion).toEqual({
      id: "a2",
      label: "v2",
    });
    expect(result.current.hasMore).toBe(false);
  });

  it("reads older runs a page at a time", async () => {
    axios.get
      .mockResolvedValueOnce({
        data: { count: 60, results: [execution("e60", "Completed")] },
      })
      .mockResolvedValueOnce({
        data: {
          count: 60,
          results: [
            execution("e10", "Completed"),
            execution("e9", "Completed"),
          ],
        },
      });

    const { result } = renderHook(() => useFinishedRuns(ENV), { wrapper });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.runs).toHaveLength(3));
    expect(axios.get).toHaveBeenLastCalledWith(RUNS_PATH, {
      params: { page: 2, limit: 50, summary: true },
    });
    expect(result.current.runs.map((run) => run.label)).toEqual([
      "Run 60",
      "Run 10",
      "Run 9",
    ]);
    expect(result.current.hasMore).toBe(false);
  });

  it("does not poll while a run is still going", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      axios.get.mockResolvedValue({
        data: { count: 1, results: [execution("e1", "Running")] },
      });

      renderHook(() => useFinishedRuns(ENV), { wrapper });
      await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(1));
      await act(() => vi.advanceTimersByTimeAsync(10000));

      expect(axios.get).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when the runs fail to load and reads them again", async () => {
    axios.get.mockRejectedValue({ statusCode: 500, message: "down" });
    const { result } = renderHook(() => useFinishedRuns(ENV), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.runs).toEqual([]);

    let resolve;
    axios.get.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.isError).toBe(false);
    await act(async () =>
      resolve({ data: { count: 1, results: [execution("e1", "Completed")] } }),
    );
    await waitFor(() => expect(result.current.runs).toHaveLength(1));
    expect(result.current.isError).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it("waits for the environment's run test, or until enabled", () => {
    renderHook(() => useFinishedRuns({}), { wrapper });
    renderHook(() => useFinishedRuns(ENV, { enabled: false }), { wrapper });

    expect(axios.get).not.toHaveBeenCalled();
  });
});
