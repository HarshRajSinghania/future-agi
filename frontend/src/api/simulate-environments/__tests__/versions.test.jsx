import { describe, it, expect, vi, beforeEach } from "vitest";
import PropTypes from "prop-types";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("src/utils/axios", () => ({ default: { get: vi.fn() } }));

const { default: axios } = await import("src/utils/axios");
const {
  useEnvironmentVersions,
  useVersionDiff,
  useSuiteMembers,
  useRunPlan,
  runPlanKey,
  environmentVersionsKey,
  versionDiffKey,
  suiteMembersKey,
  toVersions,
  versionFromApi,
  isVersioningDisabled,
} = await import("../versions");

let client;
const wrapper = ({ children }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
wrapper.propTypes = { children: PropTypes.node };

const RESPONSE = {
  agent: [
    {
      id: "a1",
      label: "v4",
      status: "active",
      is_default: true,
      created_at: "2026-10-15T10:00:00Z",
    },
  ],
  environment: [
    {
      id: "e2",
      label: "v2",
      status: "active",
      is_default: true,
      created_by: { id: "u1", name: "Asha" },
      origin: "chat",
      summary: "1 tool added",
      parent_id: "e1",
      derived_from_agent_version_id: "a1",
    },
    {
      id: "e1",
      label: "v1",
      status: "active",
      is_default: false,
      origin: "backfill",
    },
  ],
  suite: [
    {
      id: "s3",
      label: "v3",
      status: "draft",
      is_default: true,
      scenario_count: 12,
    },
  ],
};

beforeEach(() => {
  // The hooks bring their own retry rule; no delay keeps retries fast here.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  axios.get.mockReset();
});

describe("versionFromApi / toVersions", () => {
  it("maps the wire shape to camelCase", () => {
    expect(versionFromApi(RESPONSE.environment[0])).toEqual({
      id: "e2",
      label: "v2",
      status: "active",
      isDefault: true,
      createdAt: null,
      createdBy: "Asha",
      origin: "chat",
      summary: "1 tool added",
      hash: null,
      parentId: "e1",
      derivedFromAgentVersionId: "a1",
      scenarioCount: null,
      preflightStatus: null,
    });
  });

  it("finds each piece's default and tells an empty history apart", () => {
    const versions = toVersions(RESPONSE);
    expect(versions.defaults.environment.label).toBe("v2");
    expect(versions.defaults.agent.label).toBe("v4");
    expect(versions.defaults.suite.scenarioCount).toBe(12);
    expect(versions.empty).toBe(false);

    const none = toVersions({ agent: [], environment: [], suite: [] });
    expect(none.empty).toBe(true);
    expect(none.defaults.environment).toBeNull();
    expect(toVersions(undefined).empty).toBe(true);
  });
});

describe("useEnvironmentVersions", () => {
  it("reads the environment's versions under its own key", async () => {
    axios.get.mockResolvedValue({ data: RESPONSE });
    const { result } = renderHook(() => useEnvironmentVersions("env-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(axios.get).toHaveBeenCalledWith(
      "/simulate/api/harness-environments/env-1/versions/",
    );
    expect(result.current.data.environment.map((v) => v.label)).toEqual([
      "v2",
      "v1",
    ]);
    expect(client.getQueryData(environmentVersionsKey("env-1"))).toEqual(
      RESPONSE,
    );
    expect(environmentVersionsKey("env-1")).toEqual([
      "harness-env-versions",
      "env-1",
    ]);
  });

  it("asks nothing while versioning is off or without an id", () => {
    renderHook(() => useEnvironmentVersions("env-1", { enabled: false }), {
      wrapper,
    });
    renderHook(() => useEnvironmentVersions(undefined), { wrapper });
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe("useVersionDiff", () => {
  it("reads one version's changes against its parent", async () => {
    axios.get.mockResolvedValue({
      data: { summary: "1 tool added", diff: {} },
    });
    const { result } = renderHook(
      () => useVersionDiff("env-1", "environment", "e2"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(axios.get).toHaveBeenCalledWith(
      "/simulate/api/harness-environments/env-1/versions/environment/e2/diff/",
      { params: undefined },
    );
  });

  it("passes the version to compare against and keys on it", async () => {
    axios.get.mockResolvedValue({ data: { summary: "", diff: null } });
    const { result } = renderHook(
      () => useVersionDiff("env-1", "suite", "s3", "s1"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(axios.get).toHaveBeenCalledWith(
      "/simulate/api/harness-environments/env-1/versions/suite/s3/diff/",
      { params: { against: "s1" } },
    );
    expect(versionDiffKey("env-1", "suite", "s3", "s1")).toEqual([
      "harness-env-versions",
      "env-1",
      "diff",
      "suite",
      "s3",
      "s1",
    ]);
  });

  it("waits for a version id", () => {
    renderHook(() => useVersionDiff("env-1", "suite", undefined), { wrapper });
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe("useSuiteMembers", () => {
  it("reads a suite version's scenarios", async () => {
    const members = [
      {
        scenario_key: "refund",
        number: 1,
        name: "Refund",
        use_case: "billing",
      },
    ];
    axios.get.mockResolvedValue({ data: members });
    const { result } = renderHook(() => useSuiteMembers("env-1", "s3"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(axios.get).toHaveBeenCalledWith(
      "/simulate/api/harness-environments/env-1/versions/suite/s3/members/",
    );
    expect(result.current.data).toEqual(members);
    expect(suiteMembersKey("env-1", "s3")).toEqual([
      "harness-env-versions",
      "env-1",
      "members",
      "s3",
    ]);
  });

  it("treats an odd response as no scenarios", async () => {
    axios.get.mockResolvedValue({ data: { unexpected: true } });
    const { result } = renderHook(() => useSuiteMembers("env-1", "s3"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useRunPlan", () => {
  const PLAN = {
    versions: {
      agent: { id: "a1", label: "v4" },
      environment: { id: "e1", label: "v1" },
      suite: { id: "s3", label: "v3" },
    },
    warnings: [
      { code: "suite_unproved", message: "Suite v3 unproved", piece: "suite" },
    ],
    bundle_cached: false,
  };

  it("asks with only the picks that are set, keyed under the versions", async () => {
    axios.get.mockResolvedValue({ data: PLAN });
    const { result } = renderHook(
      () => useRunPlan("env-1", { environment: "e1", suite: undefined }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(axios.get).toHaveBeenCalledWith(
      "/simulate/api/harness-environments/env-1/run-plan/",
      { params: { environment_version_id: "e1" } },
    );
    expect(result.current.data).toEqual(PLAN);
    expect(runPlanKey("env-1", { environment: "e1" })).toEqual([
      "harness-env-versions",
      "env-1",
      "run-plan",
      null,
      "e1",
      null,
    ]);
    expect(
      client.getQueryData(runPlanKey("env-1", { environment: "e1" })),
    ).toEqual(PLAN);
  });

  it("asks with no params for the defaults", async () => {
    axios.get.mockResolvedValue({ data: PLAN });
    const { result } = renderHook(() => useRunPlan("env-1", {}), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(axios.get).toHaveBeenCalledWith(
      "/simulate/api/harness-environments/env-1/run-plan/",
      { params: {} },
    );
  });

  it("asks nothing until enabled", () => {
    renderHook(() => useRunPlan("env-1", {}, { enabled: false }), {
      wrapper,
    });
    expect(axios.get).not.toHaveBeenCalled();
  });

  it.each([
    ["a refusal", { statusCode: 422, error: "version_not_runnable" }, 1],
    ["a conflict", { statusCode: 409 }, 1],
    ["a server failure", { statusCode: 500 }, 3],
    ["a network failure", { message: "Network Error" }, 3],
  ])(
    "asks again only after a server or network failure: %s",
    async (_, error, calls) => {
      axios.get.mockRejectedValue(error);
      const { result } = renderHook(() => useRunPlan("env-1", {}), { wrapper });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(axios.get).toHaveBeenCalledTimes(calls);
    },
  );
});

describe("errors", () => {
  const notFound = Object.assign(new Error("not found"), { statusCode: 404 });
  const serverError = Object.assign(new Error("boom"), { statusCode: 500 });

  it("does not ask again after a 404 (versioning off or gone)", async () => {
    axios.get.mockRejectedValue(notFound);
    const { result } = renderHook(() => useEnvironmentVersions("env-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it("retries other failures twice", async () => {
    axios.get.mockRejectedValue(serverError);
    const { result } = renderHook(
      () => useVersionDiff("env-1", "environment", "e2"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(axios.get).toHaveBeenCalledTimes(3);
  });

  it("marks every query as handled so no generic error toast shows", async () => {
    axios.get.mockResolvedValue({ data: [] });
    renderHook(() => useEnvironmentVersions("env-1"), { wrapper });
    renderHook(() => useVersionDiff("env-1", "suite", "s3"), { wrapper });
    renderHook(() => useSuiteMembers("env-1", "s3"), { wrapper });
    await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(3));
    const metas = client
      .getQueryCache()
      .getAll()
      .map((query) => query.meta?.errorHandled);
    expect(metas).toEqual([true, true, true]);
  });
});

describe("isVersioningDisabled", () => {
  it("recognises the server switching versioning off", () => {
    expect(
      isVersioningDisabled({ statusCode: 404, error: "versioning_disabled" }),
    ).toBe(true);
  });

  it("does not treat any other failure as versioning off", () => {
    expect(isVersioningDisabled({ statusCode: 404 })).toBe(false);
    expect(
      isVersioningDisabled({ statusCode: 404, error: "version_not_found" }),
    ).toBe(false);
    expect(
      isVersioningDisabled({ statusCode: 500, error: "versioning_disabled" }),
    ).toBe(false);
    expect(isVersioningDisabled(undefined)).toBe(false);
    expect(isVersioningDisabled(null)).toBe(false);
  });
});
