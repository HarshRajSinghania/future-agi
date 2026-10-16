import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "src/utils/axios";
import { apiPath } from "src/api/contracts/api-surface";

/**
 * The version history of one environment: its agent, environment and scenario
 * suite versions, each version's diff, and a suite version's scenarios.
 *
 * The endpoints answer 404 while versioning is switched off, so every read is
 * gated on `enabled` — the workspace passes `env.versioning.enabled`. The one
 * write moves an environment or suite default back to an earlier version.
 */

export const VERSION_PIECES = ["agent", "environment", "suite"];
// TODO: step 9 moves the agent default too.
export const MOVABLE_PIECES = ["environment", "suite"];

const versionsPath = (envId) =>
  apiPath("/simulate/api/harness-environments/{id}/versions/", { id: envId });
const versionDiffPath = (envId, piece, versionId) =>
  apiPath(
    "/simulate/api/harness-environments/{id}/versions/{piece}/{version_id}/diff/",
    { id: envId, piece, version_id: versionId },
  );
const suiteMembersPath = (envId, versionId) =>
  apiPath(
    "/simulate/api/harness-environments/{id}/versions/suite/{version_id}/members/",
    { id: envId, version_id: versionId },
  );

const moveDefaultPath = (envId, piece, versionId) =>
  apiPath(
    "/simulate/api/harness-environments/{id}/versions/{piece}/{version_id}/default/",
    { id: envId, piece, version_id: versionId },
  );

const runPlanPath = (envId) =>
  apiPath("/simulate/api/harness-environments/{id}/run-plan/", { id: envId });

// A run's version picks ({agent, environment, suite} → version id) as request
// fields; a piece left unpicked is left out, so the server uses its default.
export const versionPickFields = (picks = {}) =>
  Object.fromEntries(
    VERSION_PIECES.filter((piece) => picks?.[piece]).map((piece) => [
      `${piece}_version_id`,
      picks[piece],
    ]),
  );

export const getEnvironmentVersions = async (envId) =>
  (await axios.get(versionsPath(envId))).data;

export const getVersionDiff = async (envId, piece, versionId, against) =>
  (
    await axios.get(versionDiffPath(envId, piece, versionId), {
      params: against ? { against } : undefined,
    })
  ).data;

export const getSuiteMembers = async (envId, versionId) =>
  (await axios.get(suiteMembersPath(envId, versionId))).data;

// The default the user saw rides along; a newer one refuses the move (409).
export const moveDefault = async (envId, piece, versionId, expectedDefaultId) =>
  (
    await axios.post(moveDefaultPath(envId, piece, versionId), {
      expected_default_id: expectedDefaultId ?? null,
    })
  ).data;

// What a run of these picks would use and what to warn about.
export const getRunPlan = async (envId, picks) =>
  (await axios.get(runPlanPath(envId), { params: versionPickFields(picks) }))
    .data;

export const environmentVersionsKey = (envId) => [
  "harness-env-versions",
  envId,
];
export const versionDiffKey = (envId, piece, versionId, against) => [
  ...environmentVersionsKey(envId),
  "diff",
  piece,
  versionId,
  against || null,
];
export const suiteMembersKey = (envId, versionId) => [
  ...environmentVersionsKey(envId),
  "members",
  versionId,
];

export const runPlanKey = (envId, picks = {}) => [
  ...environmentVersionsKey(envId),
  "run-plan",
  ...VERSION_PIECES.map((piece) => picks?.[piece] || null),
];

const errorStatus = (error) => error?.statusCode ?? error?.response?.status;

// The server switched versioning off after this page loaded: treat it as off,
// not as a failure worth retrying.
export const isVersioningDisabled = (error) =>
  errorStatus(error) === 404 && error?.error === "versioning_disabled";
// A 404 means versioning is off or the environment is gone; asking again won't help.
const retryUnlessNotFound = (failureCount, error) =>
  errorStatus(error) !== 404 && failureCount < 2;
// A refused plan answers the same way every time; only a server or network
// failure is worth asking again.
const retryServerFailures = (failureCount, error) => {
  const status = errorStatus(error);
  return (status === undefined || status >= 500) && failureCount < 2;
};

export const versionFromApi = (item = {}) => ({
  id: item.id,
  label: item.label || null,
  status: item.status || "active",
  isDefault: Boolean(item.is_default),
  createdAt: item.created_at || null,
  createdBy: item.created_by?.name || null,
  origin: item.origin || null,
  summary: item.summary || "",
  hash: item.hash || null,
  parentId: item.parent_id || null,
  derivedFromAgentVersionId: item.derived_from_agent_version_id || null,
  scenarioCount: item.scenario_count ?? null,
  preflightStatus: item.preflight_status || null,
});

// Only an active version that is not already the default can become it.
export const canMakeDefault = (piece, version) =>
  MOVABLE_PIECES.includes(piece) &&
  version?.status === "active" &&
  !version.isDefault;

// The three lists plus each piece's default, so readers never search for it.
export const toVersions = (data = {}) => {
  const lists = Object.fromEntries(
    VERSION_PIECES.map((piece) => [
      piece,
      (Array.isArray(data?.[piece]) ? data[piece] : []).map(versionFromApi),
    ]),
  );
  const defaults = Object.fromEntries(
    VERSION_PIECES.map((piece) => [
      piece,
      lists[piece].find((version) => version.isDefault) || null,
    ]),
  );
  const empty = VERSION_PIECES.every((piece) => lists[piece].length === 0);
  return { ...lists, defaults, empty };
};

export function useEnvironmentVersions(envId, { enabled = true } = {}) {
  return useQuery({
    queryKey: environmentVersionsKey(envId),
    queryFn: () => getEnvironmentVersions(envId),
    select: toVersions,
    enabled: Boolean(envId) && enabled,
    retry: retryUnlessNotFound,
    meta: { errorHandled: true },
  });
}

export function useVersionDiff(
  envId,
  piece,
  versionId,
  against,
  { enabled = true } = {},
) {
  return useQuery({
    queryKey: versionDiffKey(envId, piece, versionId, against),
    queryFn: () => getVersionDiff(envId, piece, versionId, against),
    enabled: Boolean(envId && piece && versionId) && enabled,
    retry: retryUnlessNotFound,
    meta: { errorHandled: true },
  });
}

export function useSuiteMembers(envId, versionId, { enabled = true } = {}) {
  return useQuery({
    queryKey: suiteMembersKey(envId, versionId),
    queryFn: () => getSuiteMembers(envId, versionId),
    select: (data) => (Array.isArray(data) ? data : []),
    enabled: Boolean(envId && versionId) && enabled,
    retry: retryUnlessNotFound,
    meta: { errorHandled: true },
  });
}

export function useRunPlan(envId, picks, { enabled = true } = {}) {
  return useQuery({
    queryKey: runPlanKey(envId, picks),
    queryFn: () => getRunPlan(envId, picks),
    enabled: Boolean(envId) && enabled,
    retry: retryServerFailures,
    meta: { errorHandled: true },
  });
}

// Make a version the default. The answer is every version, so it seeds the list;
// the environment detail, the job and the scenarios follow the default, so they
// are asked again too. A conflict means the default moved elsewhere: refresh so
// the user picks again from what is current. Keys are environment.js's and
// scenariosHooks.js's literals, which import this module.
export function useMoveDefault(envId) {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: environmentVersionsKey(envId) });
    queryClient.invalidateQueries({ queryKey: ["harness-environment", envId] });
    queryClient.invalidateQueries({ queryKey: ["harness-job", envId] });
    queryClient.invalidateQueries({ queryKey: ["harness-scenarios", envId] });
  };
  return useMutation({
    meta: { errorHandled: true },
    mutationFn: ({ piece, versionId, expectedDefaultId }) =>
      moveDefault(envId, piece, versionId, expectedDefaultId),
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(environmentVersionsKey(envId), data);
      refresh();
    },
    onError: (error) => {
      if (errorStatus(error) === 409 && error?.error === "version_conflict") {
        refresh();
      } else if (
        errorStatus(error) === 422 &&
        error?.error === "version_not_pickable"
      ) {
        // Discarded meanwhile: refresh the list so the action goes away.
        queryClient.invalidateQueries({
          queryKey: environmentVersionsKey(envId),
        });
      }
    },
  });
}
