import { useCallback, useEffect, useRef, useState } from "react";
import { ASK_PARAM, readHandoff } from "src/sections/projects/observeHandoff";

// Removes the hand-off key from a query string, keeping everything else.
export function withoutAskParam(search) {
  const params = new URLSearchParams(search || "");
  params.delete(ASK_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/**
 * Open/closed state of a view's Instant eval drawer. The drawer mounts on
 * first open and stays mounted, so a run keeps polling while it is closed.
 * A link carrying `?ask=<key>` (from Insights) opens it prefilled with the
 * hand-off, and the key is dropped from the URL so a reload doesn't reopen it.
 */
export function useInstantEvalLauncher({ enabled = true, navigate }) {
  const [state, setState] = useState({
    open: false,
    mounted: false,
    seed: null,
    seedKey: null,
  });
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const key = new URLSearchParams(window.location.search).get(ASK_PARAM);
    if (!key) return;
    const seed = readHandoff(key);
    navigateRef.current?.(
      {
        pathname: window.location.pathname,
        search: withoutAskParam(window.location.search),
      },
      { replace: true },
    );
    setState({ open: true, mounted: true, seed, seedKey: key });
  }, [enabled]);

  const openDrawer = useCallback(
    () => setState((prev) => ({ ...prev, open: true, mounted: true })),
    [],
  );
  const close = useCallback(
    () => setState((prev) => ({ ...prev, open: false })),
    [],
  );

  return { ...state, openDrawer, close };
}
