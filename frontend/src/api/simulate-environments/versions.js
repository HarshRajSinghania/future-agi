import { useQuery } from "@tanstack/react-query";
import axios from "src/utils/axios";
import { apiPath } from "src/api/contracts/api-surface";

/**
 * The version history of one environment: its agent, environment and scenario
 * suite versions, each version's diff, and a suite version's scenarios.
 *
 * Read-only. The endpoints answer 404 while versioning is switched off, so every
 * hook is gated on `enabled` — the workspace passes `env.versioning.enabled`.
 */

export const VERSION_PIECES = ["agent", "environment", "suite"];

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

const errorStatus = (error) => error?.statusCode ?? error?.response?.status;

// The server switched versioning off after this page loaded: treat it as off,
// not as a failure worth retrying.
export const isVersioningDisabled = (error) =>
  errorStatus(error) === 404 && error?.error === "versioning_disabled";
// A 404 means versioning is off or the environment is gone; asking again won't help.
const retryUnlessNotFound = (failureCount, error) =>
  errorStatus(error) !== 404 && failureCount < 2;

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
