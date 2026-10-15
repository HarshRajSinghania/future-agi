import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { paths } from "src/routes/paths";
import { groupCandidates, planRunGroup } from "../_mock/runGroup";
import { useSimStore } from "../store";

/**
 * Start one agent version in several environments at once.
 *
 *   const group = useRunGroup(env.id);
 *   group.candidates              // other environments testing the same agent
 *   group.start(["env-b"], { trials: 3 })
 *
 * `start` records one pending run per environment — this one first — and opens
 * this environment's. With no other environment picked, callers keep their own
 * single-run path; a group of one is not a group.
 */
export default function useRunGroup(envId) {
  const { state, commit } = useSimStore();
  const navigate = useNavigate();
  const candidates = useMemo(() => groupCandidates(state, envId), [state, envId]);

  const start = useCallback((otherEnvIds, { trials = 3 } = {}) => {
    const { records, leader, group } = planRunGroup(state, envId, otherEnvIds, { trials });
    /* Saved before navigating, so every member is in history even if the
       page that started them unmounts first. */
    records.forEach(({ envId: id, run }) => commit({ type: "recordRun", envId: id, run }));
    const q = new URLSearchParams({ trials: String(trials) });
    if (group.agentVersion) q.set("agent", group.agentVersion);
    navigate(`${paths.dashboard.simulate.simulationRun(leader.envId, leader.run.id)}?${q.toString()}`);
  }, [state, envId, commit, navigate]);

  return { candidates, start };
}
