import { useEffect, useState } from "react";
import { PREFLIGHT_MS } from "../_mock/secretRefs";

/**
 * Whether an access check stamped at `at` is still "running" on screen.
 *
 * The check's result is saved with the reference in one write, so nothing
 * can be left half-checked if the panel closes; the wait is only how long the
 * result stays behind "Re-checking access…".
 */
export default function usePreflightPending(at) {
  const started = at ? Date.parse(at) : 0;
  const left = started ? started + PREFLIGHT_MS - Date.now() : 0;
  const [, tick] = useState(0);
  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setTimeout(() => tick((n) => n + 1), left + 20);
    return () => clearTimeout(t);
  }, [at, left]);
  return left > 0;
}
