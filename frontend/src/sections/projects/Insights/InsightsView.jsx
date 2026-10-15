import React, { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useSearchParams } from "react-router-dom";
import { Alert, Box } from "@mui/material";
import {
  INSIGHTS_NEW_PARAM,
  INSIGHTS_SEED_PARAM,
  readHandoff,
} from "src/sections/projects/observeHandoff";
import { useInsightsConfigs } from "./insightsApi";
import NewReport from "./NewReport";
import ReportPage from "./ReportPage";
import ReportsHome from "./ReportsHome";
import RerunDialog from "./RerunDialog";

// The Insights tab. The URL is the source of truth:
//   (none)                       reports home
//   ?new=1[&seed=<key>][&lens=]  new report; seed is a hand-off from a view
//   ?report=<id>[&run=<id>]      a report, its latest run or the given one
//     [&category=<id>][&example=<unit id>]  drawers open on it
const LENS_PARAM = "lens";
const REPORT_PARAM = "report";
const RUN_PARAM = "run";
const CATEGORY_PARAM = "category";
const EXAMPLE_PARAM = "example";

export default function InsightsView() {
  const { observeId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const isNew = searchParams.get(INSIGHTS_NEW_PARAM) === "1";
  const seedKey = searchParams.get(INSIGHTS_SEED_PARAM);
  const lens = searchParams.get(LENS_PARAM);
  const reportId = searchParams.get(REPORT_PARAM);
  const runId = searchParams.get(RUN_PARAM);
  const categoryId = searchParams.get(CATEGORY_PARAM);
  const exampleId = searchParams.get(EXAMPLE_PARAM);
  const seed = useMemo(() => readHandoff(seedKey), [seedKey]);
  const configs = useInsightsConfigs(observeId);
  const [rerunConfig, setRerunConfig] = useState(null);

  const go = useCallback(
    (params, options) => setSearchParams(params, options),
    [setSearchParams],
  );

  const openReport = useCallback((id) => go({ [REPORT_PARAM]: id }), [go]);
  const showRun = useCallback(
    (configId, nextRunId, options) =>
      go({ [REPORT_PARAM]: configId, [RUN_PARAM]: nextRunId }, options),
    [go],
  );
  const onDrawer = useCallback(
    (patch) =>
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          Object.entries(patch).forEach(([key, value]) => {
            const param = key === "category" ? CATEGORY_PARAM : EXAMPLE_PARAM;
            if (value) next.set(param, value);
            else next.delete(param);
          });
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );

  let content;
  if (isNew) {
    content = (
      <>
        {seedKey && !seed && (
          <Alert severity="info" sx={{ mb: 2 }}>
            The rows handed over from the other view are no longer available in
            this tab, so this report starts from a time window instead.
          </Alert>
        )}
        <NewReport
          key={seedKey || lens || "new"}
          projectId={observeId}
          seed={seed}
          initialLens={lens}
          configs={configs.data}
          onCancel={() => go({})}
          // Replace the new-report entry so Back from the report goes home.
          onStarted={(configId, nextRunId) =>
            showRun(configId, nextRunId, { replace: true })
          }
        />
      </>
    );
  } else if (reportId) {
    content = (
      <ReportPage
        key={reportId}
        projectId={observeId}
        configId={reportId}
        runId={runId}
        categoryId={categoryId}
        exampleId={exampleId}
        onBack={() => go({})}
        onSelectRun={(nextRunId) => showRun(reportId, nextRunId)}
        onDrawer={onDrawer}
        onDeleted={() => go({}, { replace: true })}
        onStarted={(configId, nextRunId) => showRun(configId, nextRunId)}
      />
    );
  } else {
    content = (
      <ReportsHome
        projectId={observeId}
        onNew={(nextLens) =>
          go({
            [INSIGHTS_NEW_PARAM]: "1",
            ...(nextLens ? { [LENS_PARAM]: nextLens } : {}),
          })
        }
        onOpen={openReport}
        onRerun={setRerunConfig}
      />
    );
  }

  return (
    <Box sx={{ height: "100%", overflowY: "auto" }}>
      <Box sx={{ px: 3, pt: 2.5, pb: 4, maxWidth: 1440, mx: "auto" }}>
        {content}
      </Box>
      <RerunDialog
        open={Boolean(rerunConfig)}
        projectId={observeId}
        config={rerunConfig}
        onClose={() => setRerunConfig(null)}
        onStarted={(configId, nextRunId) => {
          setRerunConfig(null);
          showRun(configId, nextRunId);
        }}
      />
    </Box>
  );
}
