import { useCallback } from "react";
import { useSnackbar } from "notistack";
import { rebuildForAgent } from "../_mock/toolFit";
import { nextSnapshotLabel } from "../_mock/envSnapshot";

/** Rebuild the environment for an agent version, and say what changed. */
export function useRebuildForAgent(env, envState, patch) {
  const { enqueueSnackbar } = useSnackbar();
  return useCallback((agentLabel) => {
    const { version, added, patch: next } = rebuildForAgent(env, envState, agentLabel);
    /* Named as the environment version the rebuild mints. */
    const shown = nextSnapshotLabel(env, envState);
    patch(next);
    const learned = [...new Set(added.map((r) => r.newTool))];
    enqueueSnackbar(
      learned.length
        ? `Environment ${shown} is ready — the world now answers ${learned.join(", ")}, and ${added.length} new scenarios test ${learned.length === 1 ? "it" : "them"}.`
        : `Environment ${shown} is ready — re-derived against agent ${agentLabel}.`,
      { variant: "success", autoHideDuration: 5000 },
    );
    return version;
  }, [env, envState, patch, enqueueSnackbar]);
}

