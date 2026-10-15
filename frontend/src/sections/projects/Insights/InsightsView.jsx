import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useSearchParams } from "react-router-dom";
import { Alert, Box, Skeleton, Stack } from "@mui/material";
import {
  INSIGHTS_NEW_PARAM,
  INSIGHTS_SEED_PARAM,
  readHandoff,
} from "src/sections/projects/observeHandoff";
import { useInsightsConfigs } from "./insightsApi";
import InsightsEmpty from "./InsightsEmpty";
import NewReport from "./NewReport";
import ReportPage from "./ReportPage";
import ReportRail from "./ReportRail";
import RerunDialog from "./RerunDialog";

// The Insights tab: reports on the left, the open one on the right. The URL is
// the source of truth:
//   (none)                       the latest report (or the welcome page)
//   ?new=1[&seed=<key>][&lens=]  new report; seed is a hand-off from a view
//   ?report=<id>[&run=<id>]      a report, its latest run or the given one
//     [&category=<id>]           the category explorer instead of the report
//     [&example=<unit id>]       the example panel open over either
const LENS_PARAM = "lens";
const REPORT_PARAM = "report";
const RUN_PARAM = "run";
const CATEGORY_PARAM = "category";
const EXAMPLE_PARAM = "example";
const RAIL_KEY = "insights-rail-collapsed";

const readRailCollapsed = () => {
  try {
    return globalThis.localStorage?.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
};

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
  const [collapsed, setCollapsed] = useState(readRailCollapsed);

  const go = useCallback(
    (params, options) => setSearchParams(params, options),
    [setSearchParams],
  );

  // With nothing chosen, open the most recent report.
  const firstId = configs.data?.[0]?.id;
  useEffect(() => {
    if (isNew || reportId || !firstId) return;
    go({ [REPORT_PARAM]: firstId }, { replace: true });
  }, [isNew, reportId, firstId, go]);

  const toggleRail = () =>
    setCollapsed((value) => {
      try {
        globalThis.localStorage?.setItem(RAIL_KEY, value ? "0" : "1");
      } catch {
        // The choice lasts until the page reloads.
      }
      return !value;
    });

  const openReport = useCallback((id) => go({ [REPORT_PARAM]: id }), [go]);
  const showRun = useCallback(
    (configId, nextRunId, options) =>
      go({ [REPORT_PARAM]: configId, [RUN_PARAM]: nextRunId }, options),
    [go],
  );
  const newReport = useCallback(
    (nextLens) =>
      go({
        [INSIGHTS_NEW_PARAM]: "1",
        ...(nextLens ? { [LENS_PARAM]: nextLens } : {}),
      }),
    [go],
  );
  // The explorer is a place (Back returns to the report); the example panel
  // is a layer over it, so opening one replaces the entry.
  const setView = useCallback(
    (patch, { push = false } = {}) =>
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
        { replace: !push },
      ),
    [setSearchParams],
  );

  let content;
  if (isNew) {
    content = (
      <Box sx={{ px: 3, pt: 2.5 }}>
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
          onCancel={() => go(reportId ? { [REPORT_PARAM]: reportId } : {})}
          // Replace the new-report entry so Back from the report skips it.
          onStarted={(configId, nextRunId) =>
            showRun(configId, nextRunId, { replace: true })
          }
        />
      </Box>
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
        onSelectRun={(nextRunId) => showRun(reportId, nextRunId)}
        onView={setView}
        onDeleted={() => go({}, { replace: true })}
        onStarted={(configId, nextRunId) => showRun(configId, nextRunId)}
      />
    );
  } else if (!configs.isLoading && !configs.isError && !firstId) {
    content = <InsightsEmpty onNew={newReport} />;
  } else if (configs.isLoading) {
    content = (
      <Stack spacing={2} sx={{ px: 3, pt: 2.5, maxWidth: 1180, mx: "auto" }}>
        <Skeleton variant="text" width={320} height={32} />
        <Skeleton variant="rounded" height={248} />
        <Skeleton variant="text" width="55%" height={36} />
        <Skeleton variant="rounded" height={160} />
      </Stack>
    );
  } else {
    content = null;
  }

  return (
    <Box sx={{ display: "flex", height: "100%", minHeight: 0 }}>
      <ReportRail
        configsQuery={configs}
        selectedId={isNew ? null : reportId}
        // The category explorer has its own tree, so it gets the width.
        collapsed={collapsed || Boolean(reportId && categoryId)}
        onToggle={() => {
          if (reportId && categoryId) {
            // Showing the reports leaves the explorer for its report.
            setView({ category: null }, { push: true });
            if (collapsed) toggleRail();
          } else toggleRail();
        }}
        onNew={newReport}
        onOpen={openReport}
        onRerun={setRerunConfig}
        onDeleted={(id) => {
          if (id === reportId) go({}, { replace: true });
        }}
      />
      <Box
        component="main"
        id="insights-pane"
        sx={{
          flex: 1,
          minWidth: 0,
          overflowY: "auto",
          position: "relative",
          bgcolor: "background.paper",
        }}
      >
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
