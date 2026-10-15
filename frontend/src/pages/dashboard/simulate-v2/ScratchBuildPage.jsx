import { Helmet } from "react-helmet-async";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Typography } from "@mui/material";
import { paths } from "src/routes/paths";
import { useSimStore } from "src/sections/simulate-v2/store";
import { protoRunId } from "src/sections/simulate-v2/_mock/executionAdapter";
import TemplateReviewLayout from "src/sections/simulate-v2/environments/TemplateReviewLayout";

/**
 * Scratch build-in-progress screen.
 *
 * Renders TemplateReviewLayout in its streaming state — same
 * animation the template flow uses so users see the Overview /
 * Agents / Contract / Scenarios / Evaluations tabs at the top while
 * the builder walks through Understanding → Building → Proving on
 * the left. Once every stage settles, the review layout unlocks its
 * tabs and the Finish setup button, which routes to the workspace.
 *
 * The alternative ScratchBuildingView (rich narrative + pipeline
 * timeline and a deriving animation on the right, no tabs) was ported over
 * but pulled from this route on request — the tabs-at-the-top
 * variation reads better here.
 */
export default function ScratchBuildPage() {
  const { envId } = useParams();
  const navigate = useNavigate();
  const { state } = useSimStore();
  const env = state.myEnvironments?.find((e) => e.id === envId);

  if (!env) {
    return (
      <Box sx={{ p: 4, height: "100%", display: "grid", placeItems: "center" }}>
        <Typography sx={{ typography: "s1", color: "text.subtitle" }}>
          Environment not found — it may have been renamed or removed.
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <Helmet>
        <title>Building {env.name} | Future AGI</title>
      </Helmet>
      <TemplateReviewLayout
        env={env}
        isTwin={false}
        onBack={() => navigate(paths.dashboard.simulate.environments)}
        onFinish={() => {
          /* Only reached once the layout's readiness check passes (agent,
             where it runs, scenarios, evaluations) and the tool fit is
             asked — otherwise it opens the workspace on the gap. Same run
             id shape and default repeats as the workspace header. */
          const runId = protoRunId(env.id, Date.now().toString(36));
          navigate(`${paths.dashboard.simulate.simulationRun(env.id, runId)}?trials=3`);
        }}
      />
    </>
  );
}
