import PropTypes from "prop-types";
import React, { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
  useTheme,
} from "@mui/material";
import { Helmet } from "react-helmet-async";
import Iconify from "src/components/iconify";

const DATASET_CASES = [
  {
    id: "support_refund_001",
    label: "Refund eligibility",
    split: "validation",
    expected: "eligible",
    status: "Passed",
    score: "0.98",
  },
  {
    id: "support_login_014",
    label: "Login recovery",
    split: "validation",
    expected: "recovery_steps",
    status: "Review",
    score: "0.74",
  },
  {
    id: "support_invoice_027",
    label: "Invoice dispute",
    split: "holdout",
    expected: "human_review",
    status: "Passed",
    score: "0.92",
  },
  {
    id: "support_cancel_031",
    label: "Cancellation policy",
    split: "holdout",
    expected: "cancellation_window",
    status: "Failed",
    score: "0.41",
  },
];

const RUN_EVENTS = [
  {
    time: "10:42:18",
    title: "Agent started",
    detail: "refund-agent · gpt-4.1-mini · dataset v12",
    type: "success",
  },
  {
    time: "10:42:21",
    title: "Tool call · account_lookup",
    detail: "support_refund_001 · 186ms · trace tr_9f3a",
    type: "info",
  },
  {
    time: "10:42:23",
    title: "Evaluator completed",
    detail: "policy_match 0.98 · groundedness 0.95",
    type: "success",
  },
  {
    time: "10:42:25",
    title: "Human review requested",
    detail: "support_login_014 · expected recovery_steps",
    type: "warning",
  },
];

const METRICS = [
  { label: "Pass rate", value: "86.7%", delta: "+8.4%", tone: "success" },
  { label: "Mean score", value: "0.87", delta: "+0.09", tone: "success" },
  { label: "Trial spread", value: "0.06", delta: "−0.02", tone: "success" },
  { label: "Regressions", value: "1", delta: "−3", tone: "success" },
];

const statusColor = (status) => {
  if (status === "Passed") return "success";
  if (status === "Failed") return "error";
  return "warning";
};

function MetricCard({ label, value, delta, tone }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 170 }}>
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Stack
          direction="row"
          alignItems="baseline"
          spacing={1}
          sx={{ mt: 0.5 }}
        >
          <Typography variant="h5" fontWeight={700}>
            {value}
          </Typography>
          <Typography variant="caption" color={`${tone}.main`} fontWeight={700}>
            {delta}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

MetricCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  delta: PropTypes.string.isRequired,
  tone: PropTypes.oneOf(["success", "info", "warning", "error"]).isRequired,
};

function LineageView() {
  const theme = useTheme();
  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
        <MetricCard
          label="Dataset cases"
          value="1,248"
          delta="+124 this week"
          tone="success"
        />
        <MetricCard
          label="Versions"
          value="12"
          delta="3 active branches"
          tone="info"
        />
        <MetricCard
          label="Last evaluated"
          value="8 min ago"
          delta="v12 · 4,992 trials"
          tone="info"
        />
      </Stack>
      <Card variant="outlined">
        <CardContent sx={{ p: 2.5 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="flex-start"
            spacing={2}
          >
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                Version lineage
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Track immutable snapshots from source import through evaluation.
              </Typography>
            </Box>
            <Chip
              size="small"
              label="support-agent-dataset"
              variant="outlined"
            />
          </Stack>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.25,
              overflowX: "auto",
              py: 3,
            }}
          >
            {[
              {
                id: "v10",
                label: "Baseline",
                meta: "1,000 cases",
                color: "default",
              },
              {
                id: "v11",
                label: "Added refunds",
                meta: "+124 cases",
                color: "info",
              },
              {
                id: "v12",
                label: "Current",
                meta: "1,248 cases",
                color: "success",
              },
            ].map((version, index, versions) => (
              <React.Fragment key={version.id}>
                <Box
                  sx={{
                    minWidth: 175,
                    p: 1.5,
                    border: 1,
                    borderColor:
                      version.id === "v12" ? "success.main" : "divider",
                    borderRadius: 1.5,
                    bgcolor:
                      version.id === "v12"
                        ? "success.lighter"
                        : "background.paper",
                    color:
                      version.id === "v12" ? "success.darker" : "text.primary",
                  }}
                >
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <Typography variant="subtitle2" fontWeight={700}>
                      {version.id}
                    </Typography>
                    <Chip
                      size="small"
                      label={version.id === "v12" ? "HEAD" : "snapshot"}
                      color={
                        version.color === "default" ? undefined : version.color
                      }
                      variant="outlined"
                    />
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    {version.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {version.meta}
                  </Typography>
                </Box>
                {index < versions.length - 1 && (
                  <Iconify
                    icon="solar:arrow-right-linear"
                    width={22}
                    color={theme.palette.text.disabled}
                  />
                )}
              </React.Fragment>
            ))}
          </Box>
          <Divider sx={{ mb: 1.5 }} />
          <Typography variant="caption" color="text.secondary">
            v12 created from <strong>v11</strong> · 2026-10-13 10:34 UTC ·
            checksum sha256: 7f2c…a91d
          </Typography>
        </CardContent>
      </Card>
      <Card variant="outlined">
        <CardContent sx={{ p: 0 }}>
          <Box sx={{ p: 2.5, pb: 1.5 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              Cases in v12
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Membership is pinned to this snapshot; run results never mutate
              the dataset.
            </Typography>
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Case</TableCell>
                <TableCell>Split</TableCell>
                <TableCell>Expected output</TableCell>
                <TableCell>Latest score</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {DATASET_CASES.map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {item.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.id}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={item.split} variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontFamily="monospace">
                      {item.expected}
                    </Typography>
                  </TableCell>
                  <TableCell>{item.score}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={item.status}
                      color={statusColor(item.status)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Stack>
  );
}

function RunsView() {
  return (
    <Stack spacing={2.5}>
      <Alert
        severity="info"
        icon={<Iconify icon="solar:info-circle-bold" />}
        sx={{ alignItems: "center" }}
      >
        This run is backed by mock data for design review. The production view
        will show live model, tool, trace, and evaluator receipts.
      </Alert>
      <Card variant="outlined">
        <CardContent sx={{ p: 2.5 }}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            spacing={2}
          >
            <Box>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="h6" fontWeight={700}>
                  refund-agent / run_2026_10_13
                </Typography>
                <Chip size="small" color="success" label="Completed" />
              </Stack>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                GraphVersion checkout-v4 · dataset v12 · 4 trials · 4,992 cases
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Iconify icon="solar:copy-linear" />}
              >
                Copy run ID
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Iconify icon="solar:download-linear" />}
              >
                Export receipt
              </Button>
            </Stack>
          </Stack>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ mt: 2.5 }}
          >
            <MetricCard
              label="Pass rate"
              value="86.7%"
              delta="+8.4% vs v11"
              tone="success"
            />
            <MetricCard
              label="Duration"
              value="18m 42s"
              delta="−2m 11s"
              tone="success"
            />
            <MetricCard
              label="Cost"
              value="$3.84"
              delta="$0.77 / 1k"
              tone="info"
            />
          </Stack>
        </CardContent>
      </Card>
      <Card variant="outlined">
        <CardContent sx={{ p: 2.5 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            sx={{ mb: 2 }}
          >
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                Execution trace
              </Typography>
              <Typography variant="body2" color="text.secondary">
                A case-level timeline for the selected trial.
              </Typography>
            </Box>
            <Chip size="small" label="trial 2 / 4" variant="outlined" />
          </Stack>
          <Stack spacing={0}>
            {RUN_EVENTS.map((event, index) => (
              <Box
                key={event.time}
                sx={{ display: "flex", gap: 2, minHeight: 68 }}
              >
                <Box sx={{ width: 70, pt: 0.25 }}>
                  <Typography variant="caption" color="text.secondary">
                    {event.time}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    position: "relative",
                    width: 16,
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: `${event.type}.main`,
                      zIndex: 1,
                      mt: 0.6,
                    }}
                  />
                  {index < RUN_EVENTS.length - 1 && (
                    <Box
                      sx={{
                        position: "absolute",
                        width: 2,
                        bgcolor: "divider",
                        top: 11,
                        bottom: -4,
                      }}
                    />
                  )}
                </Box>
                <Box sx={{ pb: 1.5 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {event.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {event.detail}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

function AnalysisView() {
  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
        {METRICS.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </Stack>
      <Card variant="outlined">
        <CardContent sx={{ p: 2.5 }}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            spacing={2}
          >
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                Compare runs
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Paired cases from the same dataset snapshot.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Chip size="small" label="v11 baseline" variant="outlined" />
              <Iconify
                icon="solar:arrow-right-linear"
                sx={{ color: "text.disabled", mt: 0.6 }}
              />
              <Chip size="small" label="v12 current" color="primary" />
            </Stack>
          </Stack>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 2 }}>
            <Chip size="small" label="split: validation" onDelete={() => {}} />
            <Chip
              size="small"
              label="metadata: region=us"
              onDelete={() => {}}
            />
            <Chip size="small" label="4 trials" onDelete={() => {}} />
          </Box>
          <Table size="small" sx={{ mt: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>Metric</TableCell>
                <TableCell>Baseline</TableCell>
                <TableCell>Current</TableCell>
                <TableCell>Delta</TableCell>
                <TableCell>Assessment</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {[
                ["Pass rate", "78.3%", "86.7%", "+8.4%", "Improved"],
                ["Mean score", "0.78", "0.87", "+0.09", "Improved"],
                ["Trial spread", "0.08", "0.06", "−0.02", "More stable"],
                ["Regressions", "4", "1", "−3", "Release ready"],
              ].map((row) => (
                <TableRow key={row[0]}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row[0]}
                    </Typography>
                  </TableCell>
                  <TableCell>{row[1]}</TableCell>
                  <TableCell>{row[2]}</TableCell>
                  <TableCell>
                    <Typography color="success.main" fontWeight={700}>
                      {row[3]}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color="success" label={row[4]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent sx={{ p: 2.5 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              Output diff
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              support_cancel_031 · selected case
            </Typography>
            <Box
              sx={{
                p: 1.5,
                borderRadius: 1,
                bgcolor: "error.lighter",
                fontFamily: "monospace",
                fontSize: 12,
                color: "error.darker",
              }}
            >
              − cancellation_window: 30_days
              <br />+ cancellation_window: 14_days
            </Box>
          </CardContent>
        </Card>
        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent sx={{ p: 2.5 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Iconify icon="solar:shield-check-bold" color="#2e7d32" />
              <Typography variant="subtitle1" fontWeight={700}>
                Release gate
              </Typography>
              <Chip size="small" color="success" label="Passed" />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              1 regression allowed · 0 critical cases · all pinned cases
              assessed.
            </Typography>
            <LinearProgress
              variant="determinate"
              value={100}
              color="success"
              sx={{ mt: 2, height: 7, borderRadius: 4 }}
            />
          </CardContent>
        </Card>
      </Stack>
    </Stack>
  );
}

export default function DatasetExperimentsMock() {
  const [tab, setTab] = useState(0);
  const activeView = useMemo(
    () =>
      [
        <LineageView key="lineage" />,
        <RunsView key="runs" />,
        <AnalysisView key="analysis" />,
      ][tab],
    [tab],
  );
  return (
    <>
      <Helmet>
        <title>Dataset & experiments</title>
      </Helmet>
      <Box
        sx={{
          minHeight: "100%",
          bgcolor: "background.paper",
          p: { xs: 2, md: 3 },
        }}
      >
        <Stack spacing={2.5}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", md: "center" }}
            spacing={2}
          >
            <Box>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="h5" fontWeight={700}>
                  Dataset & experiments
                </Typography>
                <Chip
                  size="small"
                  label="Prototype · mock data"
                  color="warning"
                  variant="outlined"
                />
              </Stack>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                Pin datasets, run complex agents, and understand every result.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                startIcon={<Iconify icon="solar:upload-linear" />}
              >
                Import dataset
              </Button>
              <Button
                variant="contained"
                startIcon={<Iconify icon="solar:play-circle-linear" />}
              >
                Run experiment
              </Button>
            </Stack>
          </Stack>
          <Card variant="outlined" sx={{ borderRadius: 1.5 }}>
            <Tabs
              value={tab}
              onChange={(_, value) => setTab(value)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ px: 1 }}
            >
              <Tab
                icon={<Iconify icon="solar:branching-paths-up-linear" />}
                iconPosition="start"
                label="Dataset lineage"
              />
              <Tab
                icon={<Iconify icon="solar:play-stream-linear" />}
                iconPosition="start"
                label="Agent runs"
              />
              <Tab
                icon={<Iconify icon="solar:chart-2-linear" />}
                iconPosition="start"
                label="Comparison & analysis"
              />
            </Tabs>
          </Card>
          {activeView}
        </Stack>
      </Box>
    </>
  );
}
