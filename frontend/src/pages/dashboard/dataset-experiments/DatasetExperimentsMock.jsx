import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  Drawer,
  FormControl,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { Helmet } from "react-helmet-async";
import Iconify from "src/components/iconify";
import { HeaderComponent } from "src/sections/HeaderComponent";

const DATASET = {
  name: "Support questions",
  description: "Customer support evaluation set",
  version: "v12",
  count: 1248,
  updated: "Updated 2 hours ago",
};

const VERSIONS = [
  {
    id: "v12",
    items: 1248,
    created: "Today, 09:42",
    source: "Current datapoints",
    hash: "sha256:8a91…d11c",
    parent: "v11",
    schema: "Input + expected output",
  },
  {
    id: "v11",
    items: 1248,
    created: "Jun 18, 14:10",
    source: "Imported JSONL",
    hash: "sha256:17af…0b92",
    parent: "v10",
    schema: "Input + expected output",
  },
  {
    id: "v10",
    items: 1124,
    created: "Jun 04, 16:32",
    source: "Current datapoints",
    hash: "sha256:9d20…89e0",
    parent: "—",
    schema: "Input only",
  },
];

const INITIAL_RUNS = [
  {
    id: "run-002",
    name: "Support agent · v12",
    target: "GraphVersion · support-router v31",
    targetType: "GraphVersion",
    dataset: "v12",
    evaluator: "Groundedness v4 · Policy v2",
    planKey: "support-v12|2|groundedness-v4|policy-v2",
    status: "Completed",
    progress: 100,
    planned: 1248,
    completed: 1248,
    errors: 0,
    quality: 86,
    cost: "$0.34",
    latency: "1.8s",
    created: "Today, 10:08",
    compatible: true,
  },
  {
    id: "run-001",
    name: "Support agent · baseline",
    target: "Prompt · support-router v12",
    targetType: "Prompt / model",
    dataset: "v12",
    evaluator: "Groundedness v4 · Policy v2",
    planKey: "support-v12|2|groundedness-v4|policy-v2",
    status: "Completed",
    progress: 100,
    planned: 1248,
    completed: 1248,
    errors: 0,
    quality: 82,
    cost: "$0.48",
    latency: "2.1s",
    created: "Yesterday, 16:24",
    compatible: true,
  },
  {
    id: "run-003",
    name: "Refund assistant · v12",
    target: "GraphVersion · refunds v08",
    targetType: "GraphVersion",
    dataset: "v12",
    evaluator: "Policy v2",
    planKey: "support-v12|2|policy-v2",
    status: "Partial",
    progress: 94,
    planned: 1248,
    completed: 1175,
    errors: 8,
    quality: 84,
    cost: "$0.19",
    latency: "1.3s",
    created: "Jun 18, 11:12",
    compatible: true,
  },
  {
    id: "run-004",
    name: "Support agent · retry",
    target: "External / SDK · build 9f21",
    targetType: "External / SDK",
    dataset: "v12",
    evaluator: "Groundedness v4",
    planKey: "support-v12|2|groundedness-v4",
    status: "Waiting for results",
    progress: 0,
    planned: 1248,
    completed: 0,
    errors: 0,
    quality: 0,
    cost: "—",
    latency: "—",
    created: "Jun 17, 09:03",
    compatible: false,
  },
];

const CASES = [
  {
    id: "refund-014",
    question: "Can I return an opened item?",
    split: "returns",
    metadata: "policy · high risk",
    status: "improved",
    delta: "+18",
    input: "I opened the item yesterday. Can I still return it?",
    reference: "Opened items can be returned within 30 days unless final sale.",
    baseline: "Opened items can be returned within 30 days.",
    candidate:
      "Opened items are eligible within 30 days, unless the item is marked final sale. Start a return from your order history.",
    baselineScore: 62,
    candidateScore: 94,
    diff: "Added the final-sale exception and a clear next step.",
    trace: "Available",
    traceDetail: "12 spans · retrieval and policy evaluator linked",
  },
  {
    id: "cancel-031",
    question: "How do I cancel my plan?",
    split: "billing",
    metadata: "account · medium risk",
    status: "regressed",
    delta: "−24",
    input: "I no longer need the Pro plan. How do I cancel?",
    reference: "Cancel anytime from Settings → Plan.",
    baseline: "You can cancel anytime from Settings → Plan.",
    candidate:
      "Plans can be canceled after the 14-day trial. Contact support to request a cancellation.",
    baselineScore: 91,
    candidateScore: 67,
    diff: "Changed the policy window from anytime to after the trial.",
    trace: "Available",
    traceDetail: "12 spans · retrieval miss for cancellation policy",
  },
  {
    id: "invoice-027",
    question: "Why is my invoice different?",
    split: "billing",
    metadata: "invoice · low risk",
    status: "unchanged",
    delta: "0",
    input: "This month's invoice is higher than last month's.",
    reference: "Invoices can include prorated usage and taxes.",
    baseline: "Invoices may include prorated usage and taxes.",
    candidate: "Invoices may include prorated usage and taxes.",
    baselineScore: 88,
    candidateScore: 88,
    diff: "No material output change.",
    trace: "Available",
    traceDetail: "8 spans · citation check passed",
  },
  {
    id: "delivery-102",
    question: "Where is my delivery?",
    split: "shipping",
    metadata: "order · medium risk",
    status: "missing",
    delta: "—",
    input: "Can you check where my order is?",
    reference: "Ask for the order number and check shipment status.",
    baseline: "No answer recorded.",
    candidate: "The run did not return an answer before the timeout.",
    baselineScore: null,
    candidateScore: null,
    diff: "Candidate timed out after 30 seconds.",
    trace: "Unavailable",
    traceDetail: "No trace was persisted for this case",
  },
  {
    id: "exchange-044",
    question: "Can I exchange a sale item?",
    split: "returns",
    metadata: "policy · medium risk",
    status: "improved",
    delta: "+9",
    input: "Can I exchange a sale item for another size?",
    reference: "Sale items can be exchanged for another size within 14 days.",
    baseline: "Sale items may be exchanged.",
    candidate: "Sale items can be exchanged for another size within 14 days.",
    baselineScore: 73,
    candidateScore: 82,
    diff: "Added size and time-window constraints.",
    trace: "Available",
    traceDetail: "10 spans · human review note attached",
  },
];

const STATUS = {
  improved: {
    label: "Improved",
    color: "success",
    icon: "solar:arrow-up-bold",
  },
  regressed: {
    label: "Regressed",
    color: "error",
    icon: "solar:arrow-down-bold",
  },
  unchanged: {
    label: "Unchanged",
    color: "default",
    icon: "solar:minus-circle-linear",
  },
  missing: {
    label: "Incomplete",
    color: "warning",
    icon: "solar:danger-triangle-bold",
  },
};

const RUN_SHAPE = PropTypes.shape({
  id: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  target: PropTypes.string.isRequired,
  targetType: PropTypes.string.isRequired,
  dataset: PropTypes.string.isRequired,
  evaluator: PropTypes.string.isRequired,
  planKey: PropTypes.string.isRequired,
  status: PropTypes.string.isRequired,
  progress: PropTypes.number.isRequired,
  planned: PropTypes.number.isRequired,
  completed: PropTypes.number.isRequired,
  errors: PropTypes.number.isRequired,
  quality: PropTypes.number.isRequired,
  cost: PropTypes.string.isRequired,
  latency: PropTypes.string.isRequired,
  created: PropTypes.string.isRequired,
  compatible: PropTypes.bool.isRequired,
});

const CASE_SHAPE = PropTypes.shape({
  id: PropTypes.string.isRequired,
  question: PropTypes.string.isRequired,
  split: PropTypes.string.isRequired,
  metadata: PropTypes.string.isRequired,
  status: PropTypes.oneOf(["improved", "regressed", "unchanged", "missing"])
    .isRequired,
  delta: PropTypes.string.isRequired,
  input: PropTypes.string.isRequired,
  reference: PropTypes.string.isRequired,
  baseline: PropTypes.string.isRequired,
  candidate: PropTypes.string.isRequired,
  baselineScore: PropTypes.number,
  candidateScore: PropTypes.number,
  diff: PropTypes.string.isRequired,
  trace: PropTypes.string.isRequired,
  traceDetail: PropTypes.string.isRequired,
});

function OutcomeChip({ status }) {
  const item = STATUS[status];
  return (
    <Chip
      size="small"
      icon={<Iconify icon={item.icon} width={14} />}
      label={item.label}
      color={item.color}
      variant={status === "unchanged" ? "outlined" : "filled"}
    />
  );
}
OutcomeChip.propTypes = {
  status: PropTypes.oneOf(["improved", "regressed", "unchanged", "missing"])
    .isRequired,
};

function RunStatus({ status }) {
  return (
    <Chip
      size="small"
      label={status}
      color={
        status === "Completed"
          ? "success"
          : status === "Partial"
            ? "warning"
            : status === "Waiting for results"
              ? "info"
              : "default"
      }
      variant="outlined"
    />
  );
}
RunStatus.propTypes = { status: PropTypes.string.isRequired };

function VersionDrawer({ version, onClose, onUse, onCreate }) {
  if (!version) return null;
  return (
    <Drawer
      anchor="right"
      open={Boolean(version)}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 440 }, p: 2.5 } }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
      >
        <Box>
          <Typography variant="overline" color="text.secondary">
            Dataset version
          </Typography>
          <Typography variant="h6" fontWeight={800}>
            {DATASET.name} · {version.id}
          </Typography>
        </Box>
        <IconButton aria-label="Close version" onClick={onClose}>
          <Iconify icon="solar:close-circle-linear" />
        </IconButton>
      </Stack>
      <Chip
        label="Immutable snapshot"
        color="success"
        variant="outlined"
        size="small"
        sx={{ mt: 1 }}
      />
      <Divider sx={{ my: 2 }} />
      <Stack spacing={1.5}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Membership
          </Typography>
          <Typography variant="body2" fontWeight={700}>
            {version.items.toLocaleString()} immutable examples
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Created / provenance
          </Typography>
          <Typography variant="body2" fontWeight={700}>
            {version.created}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {version.source} · {version.hash}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Schema / parent
          </Typography>
          <Typography variant="body2" fontWeight={700}>
            {version.schema}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Child of {version.parent}
          </Typography>
        </Paper>
        <Alert severity="info">
          Runs pinned to this version do not change when the live dataset is
          edited.
        </Alert>
        <Button variant="contained" onClick={() => onUse(version.id)}>
          Use this version for a new run
        </Button>
        <Button variant="outlined" onClick={() => onCreate(version.id)}>
          Create child version
        </Button>
      </Stack>
    </Drawer>
  );
}
VersionDrawer.propTypes = {
  version: PropTypes.shape({
    id: PropTypes.string.isRequired,
    items: PropTypes.number.isRequired,
    created: PropTypes.string.isRequired,
    source: PropTypes.string.isRequired,
    hash: PropTypes.string.isRequired,
    parent: PropTypes.string.isRequired,
    schema: PropTypes.string.isRequired,
  }),
  onClose: PropTypes.func.isRequired,
  onUse: PropTypes.func.isRequired,
  onCreate: PropTypes.func.isRequired,
};

function CaseDrawer({
  item,
  items,
  baselineLabel = "Baseline",
  candidateLabel = "Candidate",
  onClose,
  onNavigate,
}) {
  const [tab, setTab] = useState("preview");
  const [message, setMessage] = useState("");
  if (!item) return null;
  const index = items.findIndex((entry) => entry.id === item.id);
  const action = (text) => setMessage(text);
  return (
    <Drawer
      anchor="right"
      open={Boolean(item)}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 560 } } }}
    >
      <Box sx={{ p: 2.5 }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          spacing={2}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary">
              Case {item.id}
            </Typography>
            <Typography variant="h6" fontWeight={800} sx={{ mt: 0.25 }}>
              {item.question}
            </Typography>
            <Stack direction="row" spacing={0.75} sx={{ mt: 1 }}>
              <OutcomeChip status={item.status} />
              <Chip
                size="small"
                variant="outlined"
                label={`${item.split} · ${item.metadata}`}
              />
            </Stack>
          </Box>
          <Stack direction="row" spacing={0.25}>
            <IconButton
              aria-label="Previous case"
              disabled={index <= 0}
              onClick={() => onNavigate(items[index - 1])}
            >
              <Iconify icon="solar:alt-arrow-left-linear" />
            </IconButton>
            <IconButton
              aria-label="Next case"
              disabled={index < 0 || index >= items.length - 1}
              onClick={() => onNavigate(items[index + 1])}
            >
              <Iconify icon="solar:alt-arrow-right-linear" />
            </IconButton>
            <IconButton aria-label="Close case" onClick={onClose}>
              <Iconify icon="solar:close-circle-linear" />
            </IconButton>
          </Stack>
        </Stack>
      </Box>
      <Divider />
      <Tabs
        value={tab}
        onChange={(_, value) => {
          setTab(value);
          setMessage("");
        }}
        variant="scrollable"
      >
        <Tab value="preview" label="Preview" />
        <Tab value="diff" label="Diff" />
        <Tab value="scores" label="Scores" />
        <Tab value="trace" label="Trace" />
        <Tab value="review" label="Review" />
      </Tabs>
      <Box sx={{ p: 2.5, overflowY: "auto" }}>
        {tab === "preview" && (
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" fontWeight={750}>
                Input
              </Typography>
              <Paper
                variant="outlined"
                sx={{ p: 1.5, mt: 0.75, bgcolor: "grey.50" }}
              >
                <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
                  {item.input}
                </Typography>
              </Paper>
            </Box>
            <Box>
              <Typography variant="subtitle2" fontWeight={750}>
                Expected output
              </Typography>
              <Paper
                variant="outlined"
                sx={{ p: 1.5, mt: 0.75, bgcolor: "grey.50" }}
              >
                <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
                  {item.reference}
                </Typography>
              </Paper>
            </Box>
            <OutputPair
              item={item}
              baselineLabel={baselineLabel}
              candidateLabel={candidateLabel}
            />
          </Stack>
        )}
        {tab === "diff" && (
          <Stack spacing={2}>
            <Alert
              severity={
                item.status === "regressed"
                  ? "error"
                  : item.status === "missing"
                    ? "warning"
                    : "success"
              }
            >
              {item.diff}
            </Alert>
            <Paper
              variant="outlined"
              sx={{
                p: 1.5,
                fontFamily: "monospace",
                fontSize: 13,
                lineHeight: 1.8,
              }}
            >
              <Box sx={{ color: "error.main" }}>− {item.baseline}</Box>
              <Box sx={{ color: "success.main", mt: 1 }}>
                + {item.candidate}
              </Box>
            </Paper>
            <Typography variant="caption" color="text.secondary">
              Missing output is not treated as a zero score.
            </Typography>
          </Stack>
        )}
        {tab === "scores" && (
          <Stack spacing={2}>
            <Typography variant="subtitle2" fontWeight={750}>
              Evaluator evidence
            </Typography>
            {item.baselineScore == null ? (
              <Alert severity="warning">
                No finite evaluator score was recorded for this case.
              </Alert>
            ) : (
              <>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2">Answer quality</Typography>
                  <Typography variant="body2" fontWeight={750}>
                    {item.baselineScore}% → {item.candidateScore}%
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={item.candidateScore}
                  color={item.status === "regressed" ? "error" : "success"}
                  sx={{ height: 8, borderRadius: 4 }}
                />
                <Typography variant="caption" color="text.secondary">
                  Scores are pinned to the evaluator versions used by the run.
                  Not assessed and evaluator errors remain visible.
                </Typography>
              </>
            )}
          </Stack>
        )}
        {tab === "trace" && (
          <Stack spacing={2}>
            {item.trace === "Available" ? (
              <Alert severity="success">{item.traceDetail}</Alert>
            ) : (
              <Alert severity="warning">
                Trace is unavailable. This comparison does not claim trace
                provenance.
              </Alert>
            )}
            <Button
              variant="outlined"
              disabled={item.trace !== "Available"}
              startIcon={<Iconify icon="solar:link-linear" />}
              onClick={() =>
                action("Opened the verified trace in Observe (mock).")
              }
            >
              Open trace
            </Button>
          </Stack>
        )}
        {tab === "review" && (
          <Stack spacing={2}>
            <TextField
              label="Reviewer note"
              multiline
              minRows={4}
              placeholder="Explain what should change or why this case is acceptable…"
            />
            <Button
              variant="contained"
              onClick={() => action("Review saved to the case (mock).")}
            >
              Save review
            </Button>
          </Stack>
        )}
        {message && (
          <Alert severity="success" sx={{ mt: 2 }}>
            {message}
          </Alert>
        )}
        <Divider sx={{ my: 2.5 }} />
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button
            variant="outlined"
            onClick={() => {
              setTab("review");
              action("Annotation mode is ready (mock).");
            }}
          >
            Annotate
          </Button>
          <Button
            variant="outlined"
            onClick={() =>
              action("Case added to a child dataset version (mock).")
            }
          >
            Add to dataset
          </Button>
          <Button
            variant="outlined"
            color="error"
            onClick={() => action("Case sent to the review queue (mock).")}
          >
            Send to review
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
CaseDrawer.propTypes = {
  item: CASE_SHAPE,
  items: PropTypes.arrayOf(CASE_SHAPE).isRequired,
  baselineLabel: PropTypes.string,
  candidateLabel: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onNavigate: PropTypes.func.isRequired,
};

function OutputPair({ item, baselineLabel, candidateLabel }) {
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={750} sx={{ mb: 1 }}>
        Outputs
      </Typography>
      <Stack spacing={1}>
        <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "grey.50" }}>
          <Typography variant="caption" color="text.secondary" fontWeight={750}>
            BASELINE · {baselineLabel}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.75, lineHeight: 1.6 }}>
            {item.baseline}
          </Typography>
        </Paper>
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderColor:
              item.status === "regressed" ? "error.light" : "success.light",
            bgcolor: item.status === "regressed" ? "error.50" : "success.50",
          }}
        >
          <Typography
            variant="caption"
            color={item.status === "regressed" ? "error.main" : "success.dark"}
            fontWeight={750}
          >
            CANDIDATE · {candidateLabel}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.75, lineHeight: 1.6 }}>
            {item.candidate}
          </Typography>
        </Paper>
      </Stack>
    </Box>
  );
}
OutputPair.propTypes = {
  item: CASE_SHAPE.isRequired,
  baselineLabel: PropTypes.string.isRequired,
  candidateLabel: PropTypes.string.isRequired,
};

function RunSetupDrawer({ open, onClose, onCreated, datasetVersion }) {
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState("graph");
  const [version, setVersion] = useState(datasetVersion);
  const [evaluator, setEvaluator] = useState("Groundedness v4 · Policy v2");
  const [trials, setTrials] = useState("2");
  const [concurrency, setConcurrency] = useState("8");
  const [strict, setStrict] = useState(true);
  const [name, setName] = useState("Support agent · candidate");
  useEffect(() => setVersion(datasetVersion), [datasetVersion]);
  const targetLabel =
    target === "prompt"
      ? "Prompt · support-router v12"
      : target === "graph"
        ? "GraphVersion · support-router v31"
        : "External / SDK upload";
  const resetClose = () => {
    setStep(0);
    onClose();
  };
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={resetClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 600 } } }}
    >
      <Box sx={{ p: 2.5 }}>
        <Stack direction="row" justifyContent="space-between">
          <Box>
            <Typography variant="overline" color="text.secondary">
              New experiment run
            </Typography>
            <Typography variant="h6" fontWeight={800}>
              Run against {DATASET.name}
            </Typography>
          </Box>
          <IconButton onClick={resetClose}>
            <Iconify icon="solar:close-circle-linear" />
          </IconButton>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          Four-step setup · mock data only
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ mt: 2 }}>
          {["Target", "Dataset", "Settings", "Review"].map((label, index) => (
            <Box key={label} sx={{ flex: 1 }}>
              <Box
                sx={{
                  height: 4,
                  borderRadius: 2,
                  bgcolor: index <= step ? "primary.main" : "divider",
                }}
              />
              <Typography
                variant="caption"
                color={index === step ? "primary.main" : "text.disabled"}
              >
                {label}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>
      <Divider />
      <Box sx={{ p: 2.5, overflowY: "auto", flex: 1 }}>
        {step === 0 && (
          <Stack spacing={2}>
            <Typography variant="subtitle1" fontWeight={800}>
              Where should this run execute?
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Choose who executes the task. GraphVersion uses the existing agent
              workflow; SDK runs wait for your caller to upload results.
            </Typography>
            {[
              {
                id: "prompt",
                title: "Prompt / model",
                detail: "Run a prompt version with a model configuration.",
                icon: "solar:chat-round-dots-linear",
              },
              {
                id: "graph",
                title: "GraphVersion agent",
                detail: "Run the pinned agent graph with tools and traces.",
                icon: "solar:branching-paths-up-linear",
              },
              {
                id: "external",
                title: "External / SDK",
                detail:
                  "Create a run for code to upload; Future AGI does not execute it.",
                icon: "solar:code-square-linear",
              },
            ].map((option) => (
              <Paper
                key={option.id}
                variant="outlined"
                onClick={() => setTarget(option.id)}
                sx={{
                  p: 1.5,
                  cursor: "pointer",
                  borderColor:
                    target === option.id ? "primary.main" : "divider",
                  bgcolor:
                    target === option.id ? "primary.50" : "background.paper",
                }}
              >
                <Stack direction="row" spacing={1.25} alignItems="center">
                  <Iconify
                    icon={option.icon}
                    width={24}
                    color={
                      target === option.id ? "primary.main" : "text.secondary"
                    }
                  />
                  <Box>
                    <Typography variant="body2" fontWeight={750}>
                      {option.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {option.detail}
                    </Typography>
                  </Box>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
        {step === 1 && (
          <Stack spacing={2}>
            <Typography variant="subtitle1" fontWeight={800}>
              Pin the dataset snapshot
            </Typography>
            <FormControl fullWidth size="small">
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mb: 0.5 }}
              >
                Dataset version
              </Typography>
              <Select
                value={version}
                onChange={(event) => setVersion(event.target.value)}
              >
                {VERSIONS.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.id} · {item.items.toLocaleString()} items ·{" "}
                    {item.schema}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "grey.50" }}>
              <Typography variant="body2" fontWeight={700}>
                {DATASET.name} · {version}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Input columns: question, account_tier, order_status · Expected:
                answer
              </Typography>
            </Paper>
            <Alert severity="info">
              4 variables mapped · strict variable validation is configured
              next.
            </Alert>
          </Stack>
        )}
        {step === 2 && (
          <Stack spacing={2}>
            <Typography variant="subtitle1" fontWeight={800}>
              Evaluation and run settings
            </Typography>
            <FormControl fullWidth size="small">
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mb: 0.5 }}
              >
                Evaluator versions
              </Typography>
              <Select
                value={evaluator}
                onChange={(event) => setEvaluator(event.target.value)}
              >
                <MenuItem value="Groundedness v4 · Policy v2">
                  Groundedness v4 · Policy v2
                </MenuItem>
                <MenuItem value="Groundedness v4">Groundedness v4</MenuItem>
                <MenuItem value="None">No evaluator</MenuItem>
              </Select>
            </FormControl>
            <Stack direction="row" spacing={1.5}>
              <TextField
                fullWidth
                size="small"
                label="Trials"
                value={trials}
                onChange={(event) => setTrials(event.target.value)}
                helperText="Measure variance"
              />
              <TextField
                fullWidth
                size="small"
                label="Max concurrency"
                value={concurrency}
                onChange={(event) => setConcurrency(event.target.value)}
                helperText="Provider cap"
              />
            </Stack>
            <FormControlLabel
              control={
                <Checkbox
                  checked={strict}
                  onChange={(event) => setStrict(event.target.checked)}
                />
              }
              label="Fail closed when variables are missing"
            />
            <TextField
              fullWidth
              size="small"
              label="Run name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Stack>
        )}
        {step === 3 && (
          <Stack spacing={2}>
            <Typography variant="subtitle1" fontWeight={800}>
              Review before running
            </Typography>
            <Alert severity="info">
              The run plan is pinned before execution. Each (example, trial)
              identity must reach a terminal state.
            </Alert>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Stack spacing={1}>
                <SummaryRow label="Target" value={targetLabel} />
                <SummaryRow
                  label="Dataset"
                  value={`${DATASET.name} · ${version} · ${DATASET.count.toLocaleString()} cases`}
                />
                <SummaryRow label="Evaluators" value={evaluator} />
                <SummaryRow
                  label="Trials / concurrency"
                  value={`${trials} / ${concurrency}`}
                />
                <SummaryRow
                  label="Expected evidence"
                  value="Outputs · scores · latency · cost · trace refs"
                />
              </Stack>
            </Paper>
            <Typography variant="caption" color="text.secondary">
              {strict
                ? "Strict variable validation is on."
                : "Runs may proceed with missing variables."}{" "}
              {target === "external" &&
                "External / SDK runs wait for uploaded results."}
            </Typography>
          </Stack>
        )}
      </Box>
      <Divider />
      <Stack direction="row" justifyContent="space-between" sx={{ p: 2 }}>
        <Button
          disabled={step === 0}
          onClick={() => setStep((value) => value - 1)}
        >
          Back
        </Button>
        {step < 3 ? (
          <Button
            variant="contained"
            onClick={() => setStep((value) => value + 1)}
          >
            Continue
          </Button>
        ) : (
          <Button
            variant="contained"
            startIcon={<Iconify icon="solar:play-circle-linear" />}
            onClick={() => {
              onCreated({
                name: name || "New experiment run",
                target: targetLabel,
                targetType:
                  target === "prompt"
                    ? "Prompt / model"
                    : target === "graph"
                      ? "GraphVersion"
                      : "External / SDK",
                dataset: version,
              });
              resetClose();
            }}
          >
            Create run
          </Button>
        )}
      </Stack>
    </Drawer>
  );
}
RunSetupDrawer.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
  datasetVersion: PropTypes.string.isRequired,
};

function SummaryRow({ label, value }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={700} textAlign="right">
        {value}
      </Typography>
    </Stack>
  );
}
SummaryRow.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
};

function RunDetailDrawer({ run, onClose, onUpdate, onNotice }) {
  const [panel, setPanel] = useState("overview");
  if (!run) return null;
  const terminal =
    run.status === "Completed" ||
    run.status === "Failed" ||
    run.status === "Cancelled";
  const isExternal = run.targetType === "External / SDK";
  const phaseFor = (phase) => {
    if (run.status === "Queued" || run.status === "Waiting for results") {
      return phase === "Plan pinned"
        ? "done"
        : phase === "Waiting for SDK results"
          ? "warning"
          : "pending";
    }
    if (run.status === "Partial") {
      if (phase === "Plan pinned" || phase === "Execution") return "done";
      if (phase === "Evaluation") return "warning";
      return "pending";
    }
    if (run.status === "Completed") return "done";
    return phase === "Plan pinned" ? "done" : "warning";
  };
  const phaseIcon = (state) =>
    state === "done"
      ? "solar:check-circle-bold"
      : state === "warning"
        ? "solar:danger-triangle-bold"
        : "solar:clock-circle-linear";
  const phaseColor = (state) =>
    state === "done"
      ? "success.main"
      : state === "warning"
        ? "warning.main"
        : "text.disabled";
  const retryFailed = () => {
    onUpdate({
      status: "Running",
      progress: 96,
      completed: Math.min(run.planned, run.completed + run.errors),
      errors: 0,
    });
    onNotice("Retry started for the failed run items (mock).");
  };
  const cancelRun = () => {
    onUpdate({ status: "Cancelled" });
    onNotice("Run cancellation requested and fenced (mock).");
  };
  return (
    <Drawer
      anchor="right"
      open={Boolean(run)}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 560 } } }}
    >
      <Box sx={{ p: 2.5 }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          spacing={2}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary">
              Experiment run
            </Typography>
            <Typography variant="h6" fontWeight={800}>
              {run.name}
            </Typography>
            <Stack direction="row" spacing={0.75} sx={{ mt: 1 }}>
              <RunStatus status={run.status} />
              <Chip size="small" variant="outlined" label={run.targetType} />
            </Stack>
          </Box>
          <IconButton aria-label="Close run" onClick={onClose}>
            <Iconify icon="solar:close-circle-linear" />
          </IconButton>
        </Stack>
      </Box>
      <Divider />
      <Tabs
        value={panel}
        onChange={(_, value) => setPanel(value)}
        variant="fullWidth"
      >
        <Tab value="overview" label="Overview" />
        <Tab value="items" label="Items" />
        <Tab value="trace" label="Trace" />
      </Tabs>
      <Box sx={{ p: 2.5, overflowY: "auto" }}>
        {panel === "overview" && (
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Stack spacing={1}>
                <SummaryRow label="Execution target" value={run.target} />
                <SummaryRow
                  label="Dataset snapshot"
                  value={`${DATASET.name} · ${run.dataset}`}
                />
                <SummaryRow label="Evaluator bindings" value={run.evaluator} />
                <SummaryRow
                  label="Plan"
                  value={`${run.planned.toLocaleString()} cases · 2 trials · max concurrency 8`}
                />
              </Stack>
            </Paper>
            <Box>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="baseline"
              >
                <Typography variant="subtitle2" fontWeight={800}>
                  Run progress
                </Typography>
                <Typography variant="body2" fontWeight={750}>
                  {run.completed.toLocaleString()} /{" "}
                  {run.planned.toLocaleString()}
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={run.progress}
                color={
                  run.status === "Partial"
                    ? "warning"
                    : run.status === "Cancelled"
                      ? "inherit"
                      : "success"
                }
                sx={{ mt: 1, height: 8, borderRadius: 4 }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 0.75 }}
              >
                {run.status === "Waiting for results"
                  ? "Waiting for the caller to upload result items; Future AGI does not execute this run."
                  : run.errors
                    ? `${run.errors} items need retry or review.`
                    : terminal
                      ? "Every planned item reached a terminal state."
                      : "Items are still being processed."}
              </Typography>
            </Box>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2" fontWeight={800}>
                Execution timeline
              </Typography>
              <Stack spacing={1.25} sx={{ mt: 1.25 }}>
                {[
                  "Plan pinned",
                  isExternal ? "Waiting for SDK results" : "Execution",
                  "Evaluation",
                  "Receipt committed",
                ].map((phase) => {
                  const state = phaseFor(phase);
                  return (
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="flex-start"
                      key={phase}
                    >
                      <Iconify
                        icon={phaseIcon(state)}
                        color={phaseColor(state)}
                        width={18}
                      />
                      <Box>
                        <Typography
                          variant="body2"
                          fontWeight={state === "done" ? 700 : 500}
                        >
                          {phase}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {phase === "Plan pinned"
                            ? `${run.dataset} · ${run.planned.toLocaleString()} item identities`
                            : phase === "Evaluation"
                              ? `${run.evaluator} · missing evidence remains explicit`
                              : phase === "Receipt committed"
                                ? terminal
                                  ? "Run receipt is durable"
                                  : "Waiting for terminal item states"
                                : isExternal
                                  ? "Caller owns execution; Future AGI waits for uploads"
                                  : "Graph nodes and model calls are recorded here"}
                        </Typography>
                      </Box>
                    </Stack>
                  );
                })}
              </Stack>
            </Paper>
            {run.status === "Partial" && (
              <Alert severity="warning">
                This run is partial. The comparison gate will remain blocked
                until failed and missing items are resolved.
              </Alert>
            )}
          </Stack>
        )}
        {panel === "items" && (
          <Stack spacing={1}>
            <Typography variant="subtitle2" fontWeight={800}>
              Item state sample
            </Typography>
            {(run.status === "Waiting for results"
              ? [
                  "Waiting · all planned items",
                  "No caller result receipts yet",
                  "Trace refs not attested",
                ]
              : [
                  "Completed · refund-014",
                  "Completed · cancel-031",
                  run.errors
                    ? "Failed · delivery-102"
                    : "Completed · invoice-027",
                  "Pending · exchange-044",
                ]
            ).map((item) => (
              <Paper variant="outlined" sx={{ p: 1.25 }} key={item}>
                <Typography variant="body2">{item}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Identity includes example and trial number; retries do not
                  duplicate completed items.
                </Typography>
              </Paper>
            ))}
          </Stack>
        )}
        {panel === "trace" && (
          <Stack spacing={2}>
            <Alert severity={isExternal ? "info" : "success"}>
              {isExternal
                ? "Trace refs arrive with the caller's result upload; this UI does not claim execution."
                : "Graph root and item trace refs are available for sampled cases."}
            </Alert>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <SummaryRow
                label="Trace coverage"
                value={
                  isExternal
                    ? "Waiting for upload"
                    : run.status === "Completed"
                      ? "1,246 / 1,248 linked"
                      : "Pending"
                }
              />
              <SummaryRow
                label="Observe project"
                value={isExternal ? "Not attested" : "support-evals"}
              />
            </Paper>
            <Button
              variant="outlined"
              disabled={isExternal || run.status === "Queued"}
              onClick={() =>
                onNotice("Opened the run's verified trace view (mock).")
              }
            >
              Open run trace
            </Button>
          </Stack>
        )}
        <Divider sx={{ my: 2.5 }} />
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button
            variant="outlined"
            disabled={terminal || run.status === "Cancelled"}
            onClick={cancelRun}
          >
            Cancel run
          </Button>
          <Button
            variant="outlined"
            disabled={!run.errors}
            onClick={retryFailed}
          >
            Retry failed items
          </Button>
          <Button
            variant="contained"
            disabled={!terminal || run.status !== "Completed"}
            onClick={() =>
              onNotice(
                "Select this run with a compatible baseline to compare (mock).",
              )
            }
          >
            Use in comparison
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
RunDetailDrawer.propTypes = {
  run: RUN_SHAPE,
  onClose: PropTypes.func.isRequired,
  onUpdate: PropTypes.func.isRequired,
  onNotice: PropTypes.func.isRequired,
};

function ItemsView({ onOpenVersion }) {
  const [query, setQuery] = useState("");
  const items = CASES.filter(
    (item) =>
      !query ||
      `${item.question} ${item.id} ${item.metadata}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          spacing={2}
        >
          <Box>
            <Typography variant="h6" fontWeight={800}>
              Items
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Pinned examples used by every run. Use Experiments to inspect a
              case comparison.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              placeholder="Search items"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button size="small" variant="outlined" onClick={onOpenVersion}>
              Create version
            </Button>
          </Stack>
        </Stack>
        <TableContainer sx={{ mt: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Input</TableCell>
                <TableCell>Split</TableCell>
                <TableCell>Metadata</TableCell>
                <TableCell>Expected output</TableCell>
                <TableCell>Latest result</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => (
                <TableRow hover key={item.id} sx={{ cursor: "default" }}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>
                      {item.question}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.id}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={item.split} />
                  </TableCell>
                  <TableCell>{item.metadata}</TableCell>
                  <TableCell sx={{ maxWidth: 300 }}>
                    <Typography variant="body2" noWrap>
                      {item.reference}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <OutcomeChip status={item.status} />
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography
                      color="text.secondary"
                      sx={{ py: 4, textAlign: "center" }}
                    >
                      No items match this search.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}
ItemsView.propTypes = {
  onOpenVersion: PropTypes.func.isRequired,
};

function RunsView({
  runs,
  selectedIds,
  onToggle,
  onCompare,
  onEvaluator,
  onOpenRun,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
}) {
  const visibleRuns = runs.filter(
    (run) =>
      (statusFilter === "all" || run.status === statusFilter) &&
      (!search ||
        `${run.name} ${run.target} ${run.dataset}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const selectedRuns = runs.filter((run) => selectedIds.includes(run.id));
  const canCompare =
    selectedRuns.length === 2 &&
    selectedRuns.every((run) => run.status === "Completed" && run.compatible) &&
    selectedRuns[0].dataset === selectedRuns[1].dataset &&
    selectedRuns[0].planKey === selectedRuns[1].planKey;
  return (
    <Stack spacing={2}>
      <Card
        variant="outlined"
        sx={{
          borderRadius: 2,
          position: "sticky",
          top: 72,
          zIndex: 2,
          bgcolor: "background.paper",
        }}
      >
        <CardContent
          sx={{
            p: { xs: 2, md: 2.5 },
            "&:last-child": { pb: { xs: 2, md: 2.5 } },
          }}
        >
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            spacing={2}
            alignItems={{ md: "center" }}
          >
            <Box>
              <Typography variant="h6" fontWeight={800}>
                Runs
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Choose two completed runs when you are ready to compare them.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" size="small" onClick={onEvaluator}>
                Evaluator library
              </Button>
              <Button
                variant="contained"
                disabled={!canCompare}
                onClick={onCompare}
                startIcon={<Iconify icon="solar:chart-2-linear" />}
              >
                Compare {selectedRuns.length === 2 ? "2 runs" : "runs"}
              </Button>
            </Stack>
          </Stack>
          {selectedRuns.length === 2 && !canCompare && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              These runs cannot be compared. Both must be complete, use the same
              dataset version, and have the same pinned trial/evaluator plan.
            </Alert>
          )}
          {selectedRuns.length > 0 && (
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Chip
                color="primary"
                variant="outlined"
                label={`${selectedRuns.length} selected`}
                onDelete={() => onToggle(selectedIds[0])}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ alignSelf: "center" }}
              >
                Select exactly two rows to enable Compare.
              </Typography>
            </Stack>
          )}
        </CardContent>
      </Card>
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent
          sx={{ p: { xs: 2, md: 2.5 }, "&:last-child": { pb: 2.5 } }}
        >
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            spacing={1.5}
          >
            <Box>
              <Typography variant="subtitle1" fontWeight={800}>
                Experiment history
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {runs.length} runs · newest first
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                placeholder="Search runs"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                sx={{ width: 200 }}
              />
              <FormControl size="small" sx={{ minWidth: 135 }}>
                <Select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <MenuItem value="all">All statuses</MenuItem>
                  <MenuItem value="Completed">Completed</MenuItem>
                  <MenuItem value="Partial">Partial</MenuItem>
                  <MenuItem value="Queued">Queued</MenuItem>
                  <MenuItem value="Waiting for results">
                    Waiting for results
                  </MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </Stack>
          <TableContainer sx={{ mt: 1.5 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>Run</TableCell>
                  <TableCell>Target</TableCell>
                  <TableCell>Dataset</TableCell>
                  <TableCell>Status / progress</TableCell>
                  <TableCell>Evaluator</TableCell>
                  <TableCell>Quality</TableCell>
                  <TableCell>Latency</TableCell>
                  <TableCell>Cost</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleRuns.map((run) => (
                  <TableRow
                    key={run.id}
                    hover
                    selected={selectedIds.includes(run.id)}
                    onClick={() => onOpenRun(run)}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selectedIds.includes(run.id)}
                        onChange={() => onToggle(run.id)}
                        onClick={(event) => event.stopPropagation()}
                        inputProps={{ "aria-label": `Select ${run.name}` }}
                      />
                    </TableCell>
                    <TableCell sx={{ minWidth: 190 }}>
                      <Typography variant="body2" fontWeight={750}>
                        {run.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {run.created}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <Typography variant="body2">{run.target}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {run.targetType}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={run.dataset}
                      />
                    </TableCell>
                    <TableCell sx={{ minWidth: 130 }}>
                      <RunStatus status={run.status} />
                      <Typography
                        variant="caption"
                        display="block"
                        color="text.secondary"
                      >
                        {run.completed.toLocaleString()} /{" "}
                        {run.planned.toLocaleString()}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={run.progress}
                        color={run.status === "Partial" ? "warning" : "success"}
                        sx={{ mt: 0.5, height: 5, borderRadius: 3 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{run.evaluator}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={750}>
                        {run.quality ? `${run.quality}%` : "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>{run.latency}</TableCell>
                    <TableCell>{run.cost}</TableCell>
                  </TableRow>
                ))}
                {visibleRuns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <Typography
                        color="text.secondary"
                        sx={{ py: 4, textAlign: "center" }}
                      >
                        No runs match these filters.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Stack>
  );
}
RunsView.propTypes = {
  runs: PropTypes.arrayOf(RUN_SHAPE).isRequired,
  selectedIds: PropTypes.arrayOf(PropTypes.string).isRequired,
  onToggle: PropTypes.func.isRequired,
  onCompare: PropTypes.func.isRequired,
  onEvaluator: PropTypes.func.isRequired,
  onOpenRun: PropTypes.func.isRequired,
  search: PropTypes.string.isRequired,
  setSearch: PropTypes.func.isRequired,
  statusFilter: PropTypes.string.isRequired,
  setStatusFilter: PropTypes.func.isRequired,
};

function Metric({ label, value, detail, tone }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 155, borderRadius: 2 }}>
      <CardContent sx={{ p: 1.75, "&:last-child": { pb: 1.75 } }}>
        <Typography variant="caption" color="text.secondary" fontWeight={700}>
          {label}
        </Typography>
        <Typography
          variant="h5"
          fontWeight={850}
          color={
            tone === "error"
              ? "error.main"
              : tone === "warning"
                ? "warning.main"
                : tone === "success"
                  ? "success.main"
                  : "text.primary"
          }
          sx={{ mt: 0.5 }}
        >
          {value}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {detail}
        </Typography>
      </CardContent>
    </Card>
  );
}
Metric.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  detail: PropTypes.string.isRequired,
  tone: PropTypes.oneOf(["default", "success", "error", "warning"]),
};

function numericCost(value) {
  const parsed = Number.parseFloat(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function numericLatency(value) {
  const parsed = Number.parseFloat(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function signed(value, suffix = "") {
  return `${value >= 0 ? "+" : ""}${value}${suffix}`;
}

function CompareView({ baseline, candidate, onBack, onOpenCase }) {
  const [outcome, setOutcome] = useState("regressed");
  const [split, setSplit] = useState("all");
  const [query, setQuery] = useState("");
  const cases = CASES.filter(
    (item) =>
      (outcome === "all" || item.status === outcome) &&
      (split === "all" || item.split === split) &&
      (!query ||
        `${item.id} ${item.question} ${item.metadata}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const qualityDelta = candidate.quality - baseline.quality;
  const baselineCost = numericCost(baseline.cost);
  const candidateCost = numericCost(candidate.cost);
  const costDelta =
    baselineCost && candidateCost
      ? Math.round(((candidateCost - baselineCost) / baselineCost) * 100)
      : null;
  const baselineLatency = numericLatency(baseline.latency);
  const candidateLatency = numericLatency(candidate.latency);
  const latencyDelta =
    baselineLatency && candidateLatency
      ? Math.round((candidateLatency - baselineLatency) * 10) / 10
      : null;
  const regressionCount = CASES.filter(
    (item) => item.status === "regressed",
  ).length;
  const incompleteCount = CASES.filter(
    (item) => item.status === "missing",
  ).length;
  return (
    <>
      <HeaderComponent
        links={[
          { name: "Datasets", href: "/" },
          { name: DATASET.name, href: "/design/dataset-experiments" },
          { name: "Compare" },
        ]}
        routeDepth={3}
      />
      <Box
        sx={{
          bgcolor: "background.neutral",
          minHeight: "calc(100vh - 70px)",
          px: { xs: 2, md: 4 },
          py: { xs: 2, md: 3 },
        }}
      >
        <Box sx={{ maxWidth: 1480, mx: "auto" }}>
          <Button
            size="small"
            startIcon={<Iconify icon="solar:arrow-left-linear" />}
            onClick={onBack}
            sx={{ mb: 1.5 }}
          >
            Back to runs
          </Button>
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            alignItems={{ md: "center" }}
            spacing={2}
          >
            <Box>
              <Typography variant="h5" fontWeight={850}>
                Compare runs
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                Review the candidate against a pinned baseline before release.
              </Typography>
            </Box>
            <Chip
              color="warning"
              variant="outlined"
              label={`Review required · ${regressionCount} regression · ${incompleteCount} incomplete`}
            />
          </Stack>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1.5}
            sx={{ mt: 2 }}
          >
            <Paper
              variant="outlined"
              sx={{ p: 1.5, flex: 1, borderColor: "primary.main" }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                fontWeight={750}
              >
                BASELINE
              </Typography>
              <Typography variant="body2" fontWeight={800} sx={{ mt: 0.4 }}>
                {baseline.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {baseline.dataset} · {baseline.target} · {baseline.evaluator}
              </Typography>
            </Paper>
            <Paper
              variant="outlined"
              sx={{ p: 1.5, flex: 1, borderColor: "success.main" }}
            >
              <Typography
                variant="caption"
                color="success.dark"
                fontWeight={750}
              >
                CANDIDATE
              </Typography>
              <Typography variant="body2" fontWeight={800} sx={{ mt: 0.4 }}>
                {candidate.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {candidate.dataset} · {candidate.target} · {candidate.evaluator}
              </Typography>
            </Paper>
          </Stack>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ mt: 2 }}
          >
            <Metric
              label="Quality"
              value={`${candidate.quality}%`}
              detail={`${signed(qualityDelta, " points")} vs baseline`}
              tone={qualityDelta >= 0 ? "success" : "error"}
            />
            <Metric
              label="Cost / 1k"
              value={candidate.cost}
              detail={
                costDelta == null
                  ? "Unavailable"
                  : `${signed(costDelta, "%")} vs baseline`
              }
              tone={
                costDelta == null
                  ? "default"
                  : costDelta <= 0
                    ? "success"
                    : "error"
              }
            />
            <Metric
              label="Median latency"
              value={candidate.latency}
              detail={
                latencyDelta == null
                  ? "Unavailable"
                  : `${signed(latencyDelta, "s")} vs baseline`
              }
              tone={
                latencyDelta == null
                  ? "default"
                  : latencyDelta <= 0
                    ? "success"
                    : "error"
              }
            />
            <Metric
              label="Regressions"
              value={`${regressionCount}`}
              detail={`${incompleteCount} incomplete evidence`}
              tone="error"
            />
          </Stack>
          <Paper variant="outlined" sx={{ mt: 1.5, px: 1.5, py: 1 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={{ xs: 0.5, sm: 3 }}
            >
              <Typography variant="caption" color="text.secondary">
                <strong>Trial stability</strong> · 96% of paired cases agree
                across 2 trials
              </Typography>
              <Typography variant="caption" color="text.secondary">
                <strong>Evidence coverage</strong> · 1,247 / 1,248 assessed · 1
                incomplete blocker
              </Typography>
            </Stack>
          </Paper>
          <Card variant="outlined" sx={{ mt: 2, borderRadius: 2 }}>
            <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                justifyContent="space-between"
                spacing={1.5}
                alignItems={{ md: "center" }}
              >
                <Box>
                  <Typography variant="h6" fontWeight={800}>
                    Case review
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Click a case to inspect inputs, outputs, evaluator evidence,
                    and trace status.
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small"
                    placeholder="Search cases"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    sx={{ width: 180 }}
                  />
                  <FormControl size="small" sx={{ minWidth: 130 }}>
                    <Select
                      value={outcome}
                      onChange={(event) => setOutcome(event.target.value)}
                    >
                      <MenuItem value="regressed">Regressions</MenuItem>
                      <MenuItem value="all">All outcomes</MenuItem>
                      <MenuItem value="improved">Improvements</MenuItem>
                      <MenuItem value="unchanged">Ties</MenuItem>
                      <MenuItem value="missing">Incomplete</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 110 }}>
                    <Select
                      value={split}
                      onChange={(event) => setSplit(event.target.value)}
                    >
                      <MenuItem value="all">All splits</MenuItem>
                      <MenuItem value="returns">Returns</MenuItem>
                      <MenuItem value="billing">Billing</MenuItem>
                      <MenuItem value="shipping">Shipping</MenuItem>
                    </Select>
                  </FormControl>
                </Stack>
              </Stack>
              <Alert severity="info" sx={{ mt: 1.5 }}>
                Showing {outcome === "all" ? "all outcomes" : outcome}. Missing,
                evaluator-error, and failed cases remain explicit release
                evidence.
              </Alert>
              <TableContainer sx={{ mt: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Case</TableCell>
                      <TableCell>Split / metadata</TableCell>
                      <TableCell>Baseline output</TableCell>
                      <TableCell>Candidate output</TableCell>
                      <TableCell>Outcome</TableCell>
                      <TableCell>Score Δ</TableCell>
                      <TableCell>Trace</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {cases.map((item) => (
                      <TableRow
                        key={item.id}
                        hover
                        onClick={() => onOpenCase(item)}
                        sx={{
                          cursor: "pointer",
                          "&:hover": { bgcolor: alpha("#5d5fef", 0.05) },
                        }}
                      >
                        <TableCell sx={{ minWidth: 210 }}>
                          <Typography variant="body2" fontWeight={700}>
                            {item.question}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {item.id}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={item.split}
                          />
                          <Typography
                            variant="caption"
                            display="block"
                            color="text.secondary"
                          >
                            {item.metadata}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 220 }}>
                          <Typography variant="body2" noWrap>
                            {item.baseline}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {item.baselineScore == null
                              ? "Not assessed"
                              : `${item.baselineScore}%`}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 240 }}>
                          <Typography variant="body2" noWrap>
                            {item.candidate}
                          </Typography>
                          <Typography
                            variant="caption"
                            color={
                              item.status === "regressed"
                                ? "error.main"
                                : item.status === "missing"
                                  ? "warning.main"
                                  : "success.main"
                            }
                          >
                            {item.candidateScore == null
                              ? "No result"
                              : `${item.candidateScore}%`}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <OutcomeChip status={item.status} />
                        </TableCell>
                        <TableCell>
                          <Typography
                            fontWeight={800}
                            color={
                              item.status === "improved"
                                ? "success.main"
                                : item.status === "regressed"
                                  ? "error.main"
                                  : "text.secondary"
                            }
                          >
                            {item.delta}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Tooltip title={item.traceDetail}>
                            <Iconify
                              icon={
                                item.trace === "Available"
                                  ? "solar:check-circle-bold"
                                  : "solar:minus-circle-linear"
                              }
                              color={
                                item.trace === "Available"
                                  ? "success.main"
                                  : "text.disabled"
                              }
                            />
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                    {cases.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <Typography
                            color="text.secondary"
                            sx={{ py: 4, textAlign: "center" }}
                          >
                            No cases match these filters.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <Stack
                direction="row"
                justifyContent="space-between"
                sx={{ mt: 1.5 }}
              >
                <Typography variant="caption" color="text.secondary">
                  Showing {cases.length} of 1,248 pinned cases · plan identity
                  verified
                </Typography>
                <Button size="small" onClick={() => setOutcome("all")}>
                  Show all cases
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Box>
      </Box>
    </>
  );
}
CompareView.propTypes = {
  baseline: RUN_SHAPE.isRequired,
  candidate: RUN_SHAPE.isRequired,
  onBack: PropTypes.func.isRequired,
  onOpenCase: PropTypes.func.isRequired,
};

function SummaryView() {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
        <Typography variant="h6" fontWeight={800}>
          Summary
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          A quick view of the selected dataset version and its experiment
          evidence.
        </Typography>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.5}
          sx={{ mt: 2 }}
        >
          <Paper variant="outlined" sx={{ p: 1.75, flex: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Dataset version
            </Typography>
            <Typography variant="h6" fontWeight={800} sx={{ mt: 0.5 }}>
              {DATASET.name} · {DATASET.version}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {DATASET.count.toLocaleString()} pinned examples · immutable
              snapshot
            </Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 1.75, flex: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Latest candidate
            </Typography>
            <Typography variant="h6" fontWeight={800} sx={{ mt: 0.5 }}>
              Support agent · v12
            </Typography>
            <Typography variant="body2" color="text.secondary">
              86% quality · 1 regression needs review
            </Typography>
          </Paper>
        </Stack>
        <Alert severity="warning" sx={{ mt: 2 }}>
          Review the candidate in Experiments before marking it as a release
          baseline.
        </Alert>
      </CardContent>
    </Card>
  );
}

function OptimizationView({ onAction }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
        <Typography variant="h6" fontWeight={800}>
          Optimization
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Use the existing optimization workflow to turn reviewed cases into a
          prompt or agent improvement.
        </Typography>
        <Paper variant="outlined" sx={{ p: 1.75, mt: 2, maxWidth: 680 }}>
          <Stack direction="row" spacing={1.25} alignItems="flex-start">
            <Iconify
              icon="solar:magic-stick-3-linear"
              width={24}
              color="primary.main"
            />
            <Box>
              <Typography variant="subtitle2" fontWeight={800}>
                Start from reviewed cases
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.4 }}
              >
                Select regressions from an experiment comparison, then open the
                current optimizer with their provenance attached.
              </Typography>
              <Button
                variant="outlined"
                size="small"
                sx={{ mt: 1.25 }}
                onClick={onAction}
              >
                Open optimization workflow
              </Button>
            </Box>
          </Stack>
        </Paper>
      </CardContent>
    </Card>
  );
}
OptimizationView.propTypes = { onAction: PropTypes.func.isRequired };

export default function DatasetExperimentsMock() {
  const [screen, setScreen] = useState("dataset");
  const [tab, setTab] = useState("experiments");
  const [datasetVersion, setDatasetVersion] = useState(DATASET.version);
  const [runs, setRuns] = useState(INITIAL_RUNS);
  const [selectedRunIds, setSelectedRunIds] = useState(["run-001", "run-002"]);
  const [selectedCase, setSelectedCase] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [runSetupOpen, setRunSetupOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [runQuery, setRunQuery] = useState("");
  const [runStatus, setRunStatus] = useState("all");

  const baseline = runs.find((run) => run.id === selectedRunIds[0]) || runs[1];
  const candidate = runs.find((run) => run.id === selectedRunIds[1]) || runs[0];
  const canCompare =
    selectedRunIds.length === 2 &&
    [baseline, candidate].every(
      (run) => run.status === "Completed" && run.compatible,
    ) &&
    baseline.dataset === candidate.dataset &&
    baseline.planKey === candidate.planKey;
  const toggleRun = (id) =>
    setSelectedRunIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length < 2
          ? [...current, id]
          : current,
    );
  const createRun = (payload) => {
    const newRun = {
      ...INITIAL_RUNS[3],
      ...payload,
      id: `run-${runs.length + 1}`,
      status:
        payload.targetType === "External / SDK"
          ? "Waiting for results"
          : "Queued",
      progress: 0,
      planned: DATASET.count,
      completed: 0,
      errors: 0,
      quality: 0,
      cost: "—",
      latency: "—",
      created: "Just now",
      compatible: true,
      evaluator: "Groundedness v4 · Policy v2",
      planKey: `${payload.dataset}|2|groundedness-v4|policy-v2`,
    };
    setRuns((current) => [newRun, ...current]);
    setNotice(
      "Run created and queued. It will appear in Experiments as results arrive (mock).",
    );
    setTab("experiments");
  };
  const updateRun = (changes) => {
    if (!selectedRun) return;
    const updated = { ...selectedRun, ...changes };
    setRuns((current) =>
      current.map((run) => (run.id === updated.id ? updated : run)),
    );
    setSelectedRun(updated);
  };

  if (screen === "compare" && canCompare) {
    return (
      <>
        <Helmet>
          <title>Compare · {DATASET.name}</title>
        </Helmet>
        <CompareView
          baseline={baseline}
          candidate={candidate}
          onBack={() => {
            setSelectedCase(null);
            setScreen("dataset");
          }}
          onOpenCase={setSelectedCase}
        />
        <CaseDrawer
          item={selectedCase}
          items={CASES}
          baselineLabel={baseline.name}
          candidateLabel={candidate.name}
          onClose={() => setSelectedCase(null)}
          onNavigate={setSelectedCase}
        />
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>{DATASET.name} · Develop</title>
      </Helmet>
      <HeaderComponent
        links={[{ name: "Build", href: "/" }, { name: DATASET.name }]}
        routeDepth={1}
      />
      <Box
        sx={{
          bgcolor: "background.neutral",
          minHeight: "calc(100vh - 70px)",
          px: { xs: 2, md: 4 },
          py: { xs: 2, md: 3 },
        }}
      >
        <Box sx={{ maxWidth: 1480, mx: "auto" }}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", md: "center" }}
            spacing={2}
          >
            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="h5" fontWeight={850}>
                  {DATASET.name}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() =>
                    setSelectedVersion(
                      VERSIONS.find(
                        (version) => version.id === datasetVersion,
                      ) || VERSIONS[0],
                    )
                  }
                  endIcon={<Iconify icon="solar:alt-arrow-down-linear" />}
                >
                  Version {datasetVersion}
                </Button>
              </Stack>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                {DATASET.description} · {DATASET.count.toLocaleString()} items ·{" "}
                {DATASET.updated}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                onClick={() =>
                  setNotice(
                    "Export prepared with the current dataset version (mock).",
                  )
                }
              >
                Export
              </Button>
              <Button
                variant="contained"
                startIcon={<Iconify icon="solar:add-circle-linear" />}
                onClick={() => setRunSetupOpen(true)}
              >
                Add experiment
              </Button>
            </Stack>
          </Stack>
          {notice && (
            <Alert
              severity="success"
              sx={{ mt: 1.5 }}
              onClose={() => setNotice("")}
            >
              {notice}
            </Alert>
          )}
          <Paper
            variant="outlined"
            sx={{ mt: 2, px: 1.5, py: 1, borderRadius: 1.5 }}
          >
            <Typography variant="caption" color="text.secondary">
              <strong>Dataset context</strong> · {DATASET.name} ·{" "}
              {datasetVersion} · {DATASET.count.toLocaleString()} pinned cases ·
              schema: input + expected output
            </Typography>
          </Paper>
          <Tabs
            value={tab}
            onChange={(_, value) => setTab(value)}
            sx={{ mt: 2.5, borderBottom: 1, borderColor: "divider" }}
          >
            <Tab value="data" label="Data" />
            <Tab value="experiments" label={`Experiments ${runs.length}`} />
            <Tab value="optimization" label="Optimization" />
            <Tab value="summary" label="Summary" />
          </Tabs>
          <Box sx={{ mt: 2 }}>
            {tab === "data" && (
              <ItemsView
                onOpenVersion={() => setSelectedVersion(VERSIONS[0])}
              />
            )}
            {tab === "experiments" && (
              <RunsView
                runs={runs}
                selectedIds={selectedRunIds}
                onToggle={toggleRun}
                onCompare={() => setScreen("compare")}
                onEvaluator={() =>
                  setNotice(
                    "Evaluator library opened in the existing evaluator surface (mock).",
                  )
                }
                onOpenRun={setSelectedRun}
                search={runQuery}
                setSearch={setRunQuery}
                statusFilter={runStatus}
                setStatusFilter={setRunStatus}
              />
            )}
            {tab === "optimization" && (
              <OptimizationView
                onAction={() =>
                  setNotice(
                    "Optimization workflow opened with the current dataset context (mock).",
                  )
                }
              />
            )}
            {tab === "summary" && <SummaryView />}
          </Box>
        </Box>
      </Box>
      <VersionDrawer
        version={selectedVersion}
        onClose={() => setSelectedVersion(null)}
        onUse={(version) => {
          setDatasetVersion(version);
          setSelectedVersion(null);
          setRunSetupOpen(true);
        }}
        onCreate={(version) => {
          setNotice(`Child version draft created from ${version} (mock).`);
          setSelectedVersion(null);
        }}
      />
      <RunSetupDrawer
        open={runSetupOpen}
        onClose={() => setRunSetupOpen(false)}
        onCreated={createRun}
        datasetVersion={datasetVersion}
      />
      <RunDetailDrawer
        run={selectedRun}
        onClose={() => setSelectedRun(null)}
        onUpdate={updateRun}
        onNotice={setNotice}
      />
    </>
  );
}
