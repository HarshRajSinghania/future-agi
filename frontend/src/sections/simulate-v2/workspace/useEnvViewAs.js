import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { environmentVersions, currentEnvVersion } from "../_mock/versions";

/**
 * Viewing the workspace as an older environment version — read-only.
 *
 * Held in the URL (`?viewAs=<stored label>`) rather than in env state, so it
 * changes nothing anyone else sees and a link can be shared. Switching the
 * active version is a separate, deliberate act in the same menu. A label that
 * isn't a version, or is the active one, reads as not viewing.
 */
export default function useEnvViewAs(env, envState) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("viewAs");
  const active = currentEnvVersion(env, envState)?.label;
  const exists = environmentVersions(env, envState).some((v) => v.label === raw);
  const viewAs = raw && raw !== active && exists ? raw : null;

  const setViewAs = useCallback((label) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (label) next.set("viewAs", label);
    else next.delete("viewAs");
    return next;
  }, { replace: true }), [setParams]);

  return { viewAs, setViewAs, clearViewAs: () => setViewAs(null) };
}
