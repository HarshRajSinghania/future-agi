import React, { useMemo, useState } from "react";
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
    status: "Completed",
    progress: 100,
    planned: 1248,
    completed: 1248,
    errors: 0,
    quality: "86%",
    cost: "$0.34 / 1k",
    latency: "1.8s",
    created: "Today, 10:08",
    compatible: true,
  },
  {
    id: "run-001",
    name: "Support agent · v11",
    target: "Prompt · support-router v12",
    targetType: "Prompt / model",
    dataset: "v11",
    evaluator: "Groundedness v4 · Policy v2",
    status: "Completed",
    progress: 100,
    planned: 1248,
    completed: 1248,
    errors: 0,
    quality: "82%",
    cost: "$0.48 / 1k",
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
    status: "Completed",
    progress: 100,
    planned: 1248,
    completed: 1248,
    errors: 0,
    quality: "84%",
    cost: "$0.19 / 1k",
    latency: "1.3s",
    created: "Jun 18, 11:12",
    compatible: true,
  },
  {
    id: "run-004",
    name: "Support agent · v12 retry",
    target: "External / SDK · build 9f21",
    targetType: "External / SDK",
    dataset: "v12",
    evaluator: "Groundedness v4",
    status: "Partial",
    progress: 94,
    planned: 1248,
    completed: 1175,
    errors: 8,
    quality: "80%",
    cost: "—",
    latency: "2.0s",
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

const EVALUATORS = [
  {
    name: "Groundedness",
    version: "v4",
    type: "LLM judge",
    mapped: "4 / 4 variables",
    runs: 18,
    state: "Ready",
  },
  {
    name: "Policy compliance",
    version: "v2",
    type: "Code evaluator",
    mapped: "3 / 3 variables",
    runs: 12,
    state: "Ready",
  },
  {
    name: "Human review",
    version: "Queue",
    type: "Annotation queue",
    mapped: "On demand",
    runs: 4,
    state: "Available",
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
  status: PropTypes.string.isRequired,
  progress: PropTypes.number.isRequired,
  planned: PropTypes.number.isRequired,
  completed: PropTypes.number.isRequired,
  errors: PropTypes.number.isRequired,
  quality: PropTypes.string.isRequired,
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

function MetricCard({
  label,
  value,
  detail,
  tone = "default",
  onClick,
  active,
}) {
  const color =
    tone === "success"
      ? "success.main"
      : tone === "error"
        ? "error.main"
        : tone === "warning"
          ? "warning.main"
          : "text.primary";
  return (
    <Card
      variant="outlined"
      onClick={onClick}
      sx={{
        flex: 1,
        minWidth: 160,
        borderRadius: 2,
        cursor: onClick ? "pointer" : "default",
        borderColor: active ? "primary.main" : "divider",
        bgcolor: active ? alpha("#5d5fef", 0.05) : "background.paper",
      }}
    >
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Typography variant="caption" color="text.secondary" fontWeight={700}>
          {label}
        </Typography>
        <Typography variant="h5" fontWeight={800} sx={{ mt: 0.65, color }}>
          {value}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {detail}
        </Typography>
      </CardContent>
    </Card>
  );
}
MetricCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  detail: PropTypes.string.isRequired,
  tone: PropTypes.oneOf(["default", "success", "error", "warning"]),
  onClick: PropTypes.func,
  active: PropTypes.bool,
};

function RunPicker({ run, kind, onSet }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.25,
        flex: 1,
        borderColor: kind === "candidate" ? "success.main" : "primary.main",
        bgcolor: kind === "candidate" ? "success.50" : "primary.50",
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Iconify
          icon={kind === "candidate" ? "solar:flag-2-bold" : "solar:flag-bold"}
          color={kind === "candidate" ? "success.main" : "primary.main"}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={750}>
            {kind.toUpperCase()}
          </Typography>
          <Typography variant="body2" fontWeight={750} noWrap>
            {run.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {run.target} · {run.dataset}
          </Typography>
        </Box>
        <Button size="small" onClick={onSet}>
          Change
        </Button>
      </Stack>
    </Paper>
  );
}
RunPicker.propTypes = {
  run: RUN_SHAPE.isRequired,
  kind: PropTypes.oneOf(["baseline", "candidate"]).isRequired,
  onSet: PropTypes.func.isRequired,
};

function CaseDrawer({ item, items, onClose, onNavigate }) {
  const [tab, setTab] = useState("preview");
  const [message, setMessage] = useState("");
  if (!item) return null;
  const index = items.findIndex((entry) => entry.id === item.id);
  const showMessage = (text) => setMessage(text);
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
          <IconButton aria-label="Close case" onClick={onClose}>
            <Iconify icon="solar:close-circle-linear" />
          </IconButton>
        </Stack>
      </Box>
      <Divider />
      <Tabs
        value={tab}
        onChange={(_, value) => {
          setTab(value);
          setMessage("");
        }}
        variant="fullWidth"
      >
        <Tab value="preview" label="Preview" />
        <Tab value="diff" label="Diff" />
        <Tab value="scores" label="Scores" />
        <Tab value="trace" label="Trace" />
        <Tab value="review" label="Review" />
      </Tabs>
      <Box sx={{ p: 2.5, overflowY: "auto", flex: 1 }}>
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
            <Box>
              <Typography variant="subtitle2" fontWeight={750}>
                Outputs
              </Typography>
              <Stack spacing={1} sx={{ mt: 0.75 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    fontWeight={750}
                  >
                    BASELINE · v11
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ mt: 0.65, lineHeight: 1.6 }}
                  >
                    {item.baseline}
                  </Typography>
                </Paper>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderColor:
                      item.status === "regressed"
                        ? "error.light"
                        : "success.light",
                    bgcolor:
                      item.status === "regressed" ? "error.50" : "success.50",
                  }}
                >
                  <Typography
                    variant="caption"
                    color={
                      item.status === "regressed"
                        ? "error.main"
                        : "success.dark"
                    }
                    fontWeight={750}
                  >
                    CANDIDATE · v12
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ mt: 0.65, lineHeight: 1.6 }}
                  >
                    {item.candidate}
                  </Typography>
                </Paper>
              </Stack>
            </Box>
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
              Diff is computed from the pinned outputs. Missing output is not
              treated as a zero score.
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
                <Divider />
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2">Policy compliance</Typography>
                  <Typography
                    variant="body2"
                    color="success.main"
                    fontWeight={700}
                  >
                    {item.status === "regressed" ? "Not assessed" : "Pass"}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  Scores are pinned to the evaluator versions used by the run.
                  Not assessed and evaluator errors stay explicit.
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
                showMessage("Opened the verified trace in a new tab (mock).")
              }
            >
              Open trace
            </Button>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                Trace identity
              </Typography>
              <Typography
                variant="body2"
                fontFamily="monospace"
                sx={{ mt: 0.5 }}
              >
                {item.trace === "Available"
                  ? `trace_${item.id}_candidate`
                  : "Not recorded"}
              </Typography>
            </Paper>
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
              onClick={() =>
                showMessage("Case sent to the review queue (mock).")
              }
            >
              Send to review
            </Button>
            <Button
              variant="outlined"
              onClick={() =>
                showMessage(
                  "Created a child dataset version with this case (mock).",
                )
              }
            >
              Add to dataset
            </Button>
          </Stack>
        )}
        {message && (
          <Alert severity="success" sx={{ mt: 2 }}>
            {message}
          </Alert>
        )}
      </Box>
      <Divider />
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ p: 1.5 }}
      >
        <Button
          size="small"
          disabled={index <= 0}
          startIcon={<Iconify icon="solar:arrow-left-linear" />}
          onClick={() => onNavigate(items[index - 1])}
        >
          Previous
        </Button>
        <Typography variant="caption" color="text.secondary">
          {index + 1} of {items.length}
        </Typography>
        <Button
          size="small"
          disabled={index === -1 || index >= items.length - 1}
          endIcon={<Iconify icon="solar:arrow-right-linear" />}
          onClick={() => onNavigate(items[index + 1])}
        >
          Next
        </Button>
      </Stack>
    </Drawer>
  );
}
CaseDrawer.propTypes = {
  item: CASE_SHAPE,
  items: PropTypes.arrayOf(CASE_SHAPE).isRequired,
  onClose: PropTypes.func.isRequired,
  onNavigate: PropTypes.func.isRequired,
};

function VersionDrawer({ version, onClose, onCreate }) {
  if (!version) return null;
  return (
    <Drawer
      anchor="right"
      open={Boolean(version)}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 440 } } }}
    >
      <Box sx={{ p: 2.5 }}>
        <Stack direction="row" justifyContent="space-between">
          <Box>
            <Typography variant="overline" color="text.secondary">
              Dataset version
            </Typography>
            <Typography variant="h6" fontWeight={800}>
              {version.id}
            </Typography>
          </Box>
          <IconButton onClick={onClose}>
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
      </Box>
      <Divider />
      <Box sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Items
            </Typography>
            <Typography variant="body2" fontWeight={700}>
              {version.items.toLocaleString()}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Content hash
            </Typography>
            <Typography variant="body2" fontFamily="monospace">
              {version.hash}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Parent / source
            </Typography>
            <Typography variant="body2">
              {version.parent} · {version.source}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Schema
            </Typography>
            <Typography variant="body2">{version.schema}</Typography>
          </Box>
          <Alert severity="info">
            Runs pin this exact snapshot so later edits cannot change their
            evidence.
          </Alert>
          <Button
            variant="contained"
            startIcon={<Iconify icon="solar:copy-linear" />}
            onClick={onCreate}
          >
            Create child version
          </Button>
        </Stack>
      </Box>
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
  onCreate: PropTypes.func.isRequired,
};

function FalconDrawer({ open, onClose, onAction }) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 390 } } }}
    >
      <Box sx={{ p: 2.5 }}>
        <Stack direction="row" justifyContent="space-between">
          <Box>
            <Typography variant="overline" color="text.secondary">
              Quick actions
            </Typography>
            <Typography variant="h6" fontWeight={800}>
              Falcon
            </Typography>
          </Box>
          <IconButton onClick={onClose}>
            <Iconify icon="solar:close-circle-linear" />
          </IconButton>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Shortcuts for the dataset → run → review loop. All actions use mock
          data in this prototype.
        </Typography>
      </Box>
      <Divider />
      <Stack spacing={1} sx={{ p: 2.5 }}>
        <Button
          fullWidth
          variant="outlined"
          sx={{ justifyContent: "flex-start", py: 1.25 }}
          startIcon={<Iconify icon="solar:play-circle-linear" />}
          onClick={() => onAction("Run a new experiment")}
        >
          Run a new experiment
        </Button>
        <Button
          fullWidth
          variant="outlined"
          sx={{ justifyContent: "flex-start", py: 1.25 }}
          startIcon={<Iconify icon="solar:danger-triangle-linear" />}
          onClick={() => onAction("Opened regressions")}
        >
          Open regressions
        </Button>
        <Button
          fullWidth
          variant="outlined"
          sx={{ justifyContent: "flex-start", py: 1.25 }}
          startIcon={<Iconify icon="solar:inbox-linear" />}
          onClick={() => onAction("Review queue opened")}
        >
          Review queue
        </Button>
        <Button
          fullWidth
          variant="outlined"
          sx={{ justifyContent: "flex-start", py: 1.25 }}
          startIcon={<Iconify icon="solar:code-square-linear" />}
          onClick={() => onAction("SDK snippets copied")}
        >
          Copy SDK run snippet
        </Button>
      </Stack>
    </Drawer>
  );
}
FalconDrawer.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onAction: PropTypes.func.isRequired,
};

function RunWizard({ open, onClose, onCreate }) {
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState("graph");
  const [version, setVersion] = useState("v12");
  const [evaluator, setEvaluator] = useState("Groundedness v4 · Policy v2");
  const [trials, setTrials] = useState("2");
  const [concurrency, setConcurrency] = useState("8");
  const [strict, setStrict] = useState(true);
  const [name, setName] = useState("Support agent · candidate");
  const targetLabel =
    target === "prompt"
      ? "Prompt · support-router v12"
      : target === "graph"
        ? "GraphVersion · support-router v31"
        : "External / SDK upload";
  const closeAndReset = () => {
    setStep(0);
    onClose();
  };
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={closeAndReset}
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
          <IconButton onClick={closeAndReset}>
            <Iconify icon="solar:close-circle-linear" />
          </IconButton>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          Mock setup · no provider call is made.
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ mt: 2 }}>
          {["Target", "Dataset", "Run settings", "Review"].map(
            (label, index) => (
              <Box
                key={label}
                sx={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  bgcolor: index <= step ? "primary.main" : "divider",
                }}
              />
            ),
          )}
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
              Choose the execution owner. GraphVersion runs use the existing
              agent workflow; SDK runs wait for your caller to upload results.
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
                answer · Metadata and split filters available after pinning.
              </Typography>
            </Paper>
            <Alert severity="info">
              4 variables mapped · strict variable validation is available in
              the next step.
            </Alert>
          </Stack>
        )}
        {step === 2 && (
          <Stack spacing={2}>
            <Typography variant="subtitle1" fontWeight={800}>
              Evaluation and execution settings
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
                <MenuItem value="None">
                  No evaluator (review outputs only)
                </MenuItem>
              </Select>
            </FormControl>
            <Stack direction="row" spacing={1.5}>
              <TextField
                fullWidth
                size="small"
                label="Trials"
                value={trials}
                onChange={(event) => setTrials(event.target.value)}
                helperText="Repeat cases to measure variance"
              />
              <TextField
                fullWidth
                size="small"
                label="Max concurrency"
                value={concurrency}
                onChange={(event) => setConcurrency(event.target.value)}
                helperText="Provider rate-limit cap"
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
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    Target
                  </Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {targetLabel}
                  </Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    Dataset
                  </Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {DATASET.name} · {version} ·{" "}
                    {DATASET.count.toLocaleString()} cases
                  </Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    Evaluators
                  </Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {evaluator}
                  </Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    Trials / concurrency
                  </Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {trials} / {concurrency}
                  </Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    Expected evidence
                  </Typography>
                  <Typography variant="body2" fontWeight={700}>
                    Outputs · scores · latency · cost · trace refs
                  </Typography>
                </Stack>
              </Stack>
            </Paper>
            <Typography variant="caption" color="text.secondary">
              {strict
                ? "Strict variable validation is on."
                : "Runs may proceed with missing variables."}{" "}
              {target === "external" &&
                "External / SDK runs will show Waiting for results until the caller uploads items."}
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
              onCreate({ name, targetLabel, dataset: version });
              closeAndReset();
            }}
          >
            Create run
          </Button>
        )}
      </Stack>
    </Drawer>
  );
}
RunWizard.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreate: PropTypes.func.isRequired,
};

function RunsView({
  runs,
  selectedIds,
  baselineId,
  candidateId,
  onToggle,
  onBaseline,
  onCandidate,
  onCompare,
  compareVisible,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  onOpenCase,
}) {
  const selectedRuns = selectedIds
    .map((id) => runs.find((run) => run.id === id))
    .filter(Boolean);
  const baseline = runs.find((run) => run.id === baselineId) || runs[1];
  const candidate = runs.find((run) => run.id === candidateId) || runs[0];
  const filteredRuns = runs.filter(
    (run) =>
      (statusFilter === "all" || run.status.toLowerCase() === statusFilter) &&
      (!search ||
        `${run.name} ${run.target} ${run.dataset}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  return (
    <Stack spacing={2}>
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
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
          >
            <Box>
              <Typography variant="h6" fontWeight={800}>
                Runs
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Select two compatible runs to compare their pinned outputs and
                evaluator evidence.
              </Typography>
            </Box>
            <Button
              variant="contained"
              disabled={
                selectedRuns.length !== 2 ||
                !selectedRuns.every((run) => run.compatible)
              }
              onClick={onCompare}
              startIcon={<Iconify icon="solar:chart-2-linear" />}
            >
              Compare {selectedRuns.length === 2 ? "selected" : "runs"}
            </Button>
          </Stack>
          {selectedRuns.length > 0 && (
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1.25}
              sx={{ mt: 2 }}
            >
              <RunPicker
                run={baseline}
                kind="baseline"
                onSet={() => onBaseline(candidateId)}
              />
              <RunPicker
                run={candidate}
                kind="candidate"
                onSet={() => onCandidate(baselineId)}
              />
            </Stack>
          )}
          {selectedRuns.length === 2 &&
            !selectedRuns.every((run) => run.compatible) && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                Cannot compare: run plans differ. Select runs with the same
                dataset and evaluator plan.
              </Alert>
            )}
        </CardContent>
      </Card>
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent
          sx={{
            p: { xs: 2, md: 2.5 },
            "&:last-child": { pb: { xs: 2, md: 2.5 } },
          }}
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
                {runs.length} runs · mock data
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                placeholder="Search runs"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                sx={{ width: 190 }}
              />
              <FormControl size="small" sx={{ minWidth: 125 }}>
                <Select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <MenuItem value="all">All statuses</MenuItem>
                  <MenuItem value="completed">Completed</MenuItem>
                  <MenuItem value="partial">Partial</MenuItem>
                  <MenuItem value="running">Running</MenuItem>
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
                  <TableCell>Progress</TableCell>
                  <TableCell>Evaluator</TableCell>
                  <TableCell>Quality</TableCell>
                  <TableCell>Cost / latency</TableCell>
                  <TableCell align="right"> </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredRuns.map((run) => (
                  <TableRow
                    key={run.id}
                    hover
                    selected={selectedIds.includes(run.id)}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selectedIds.includes(run.id)}
                        onChange={() => onToggle(run.id)}
                        inputProps={{ "aria-label": `Select ${run.name}` }}
                      />
                    </TableCell>
                    <TableCell sx={{ minWidth: 190 }}>
                      <Typography variant="body2" fontWeight={750}>
                        {run.name}
                      </Typography>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Chip
                          size="small"
                          label={run.status}
                          color={
                            run.status === "Completed" ? "success" : "warning"
                          }
                          variant="outlined"
                        />
                        <Typography variant="caption" color="text.secondary">
                          {run.created}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {run.targetType}
                      </Typography>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 180 }}>
                        {run.target.replace(`${run.targetType} · `, "")}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={run.dataset}
                      />
                    </TableCell>
                    <TableCell sx={{ minWidth: 120 }}>
                      <Typography variant="caption">
                        {run.completed.toLocaleString()} /{" "}
                        {run.planned.toLocaleString()}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={run.progress}
                        color={run.status === "Partial" ? "warning" : "success"}
                        sx={{ height: 5, borderRadius: 3, mt: 0.5 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{run.evaluator}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={750}>
                        {run.quality}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{run.cost}</Typography>
                      <Typography
                        variant="caption"
                        display="block"
                        color="text.secondary"
                      >
                        {run.latency}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Set as baseline">
                        <IconButton
                          size="small"
                          onClick={() => onBaseline(run.id)}
                        >
                          <Iconify icon="solar:flag-linear" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Open run">
                        <IconButton
                          size="small"
                          onClick={() => onCandidate(run.id)}
                        >
                          <Iconify icon="solar:arrow-right-up-linear" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredRuns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <Typography
                        color="text.secondary"
                        sx={{ py: 4, textAlign: "center" }}
                      >
                        No runs match this search.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 1 }}
          >
            Select rows with the checkbox. Baseline and candidate labels update
            the comparison context.
          </Typography>
        </CardContent>
      </Card>
      {compareVisible && <CompareView onOpenCase={onOpenCase} />}
    </Stack>
  );
}
RunsView.propTypes = {
  runs: PropTypes.arrayOf(RUN_SHAPE).isRequired,
  selectedIds: PropTypes.arrayOf(PropTypes.string).isRequired,
  baselineId: PropTypes.string.isRequired,
  candidateId: PropTypes.string.isRequired,
  onToggle: PropTypes.func.isRequired,
  onBaseline: PropTypes.func.isRequired,
  onCandidate: PropTypes.func.isRequired,
  onCompare: PropTypes.func.isRequired,
  compareVisible: PropTypes.bool.isRequired,
  search: PropTypes.string.isRequired,
  setSearch: PropTypes.func.isRequired,
  statusFilter: PropTypes.string.isRequired,
  setStatusFilter: PropTypes.func.isRequired,
  onOpenCase: PropTypes.func.isRequired,
};

function CompareView({ onOpenCase }) {
  const [outcome, setOutcome] = useState("all");
  const [split, setSplit] = useState("all");
  const filtered = CASES.filter(
    (item) =>
      (outcome === "all" || item.status === outcome) &&
      (split === "all" || item.split === split),
  );
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <MetricCard
          label="Quality"
          value="86%"
          detail="+4.2 pts vs baseline"
          tone="success"
          onClick={() => setOutcome("improved")}
          active={outcome === "improved"}
        />
        <MetricCard
          label="Cost / 1k"
          value="$0.34"
          detail="−29% vs baseline"
          tone="success"
        />
        <MetricCard
          label="Median latency"
          value="1.8s"
          detail="−0.3s vs baseline"
          tone="success"
        />
        <MetricCard
          label="Regressions"
          value="2"
          detail="2 of 1,248 cases"
          tone="error"
          onClick={() => setOutcome("regressed")}
          active={outcome === "regressed"}
        />
        <MetricCard
          label="Incomplete"
          value="1"
          detail="Trace/evidence missing"
          tone="warning"
          onClick={() => setOutcome("missing")}
          active={outcome === "missing"}
        />
      </Stack>
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent
          sx={{
            p: { xs: 2, md: 2.5 },
            "&:last-child": { pb: { xs: 2, md: 2.5 } },
          }}
        >
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            spacing={1.5}
          >
            <Box>
              <Typography variant="h6" fontWeight={800}>
                Comparison
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Baseline <strong>Support agent · v11</strong> → Candidate{" "}
                <strong>Support agent · v12</strong>
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <FormControl size="small" sx={{ minWidth: 125 }}>
                <Select
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value)}
                >
                  <MenuItem value="all">All outcomes</MenuItem>
                  <MenuItem value="regressed">Regressions</MenuItem>
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
          <TableContainer sx={{ mt: 1.5 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Case</TableCell>
                  <TableCell>Metadata / split</TableCell>
                  <TableCell>Baseline</TableCell>
                  <TableCell>Candidate</TableCell>
                  <TableCell>Delta</TableCell>
                  <TableCell>Trace</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((item) => (
                  <TableRow
                    key={item.id}
                    hover
                    onClick={() => onOpenCase(item)}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell sx={{ minWidth: 220 }}>
                      <Typography variant="body2" fontWeight={750}>
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
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {item.baselineScore == null
                          ? "Not assessed"
                          : `${item.baselineScore}%`}
                      </Typography>
                    </TableCell>
                    <TableCell>
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
                      <Box sx={{ mt: 0.4 }}>
                        <OutcomeChip status={item.status} />
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        fontWeight={750}
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
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography
                        color="text.secondary"
                        sx={{ py: 4, textAlign: "center" }}
                      >
                        No cases match this filter.
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
              Showing {filtered.length} changed or sampled cases · full plan
              1,248 cases × 2 trials
            </Typography>
            <Button
              size="small"
              endIcon={<Iconify icon="solar:arrow-right-linear" />}
            >
              Open full analysis
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
CompareView.propTypes = { onOpenCase: PropTypes.func.isRequired };

function ItemsView({ onOpenCase, onVersion }) {
  const [search, setSearch] = useState("");
  const visible = CASES.filter(
    (item) =>
      !search ||
      `${item.question} ${item.id}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          spacing={1.5}
        >
          <Box>
            <Typography variant="h6" fontWeight={800}>
              Items
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Immutable examples used by every run. Select an item to inspect
              expected output and provenance.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              placeholder="Search items"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button variant="outlined" onClick={onVersion}>
              Create version
            </Button>
          </Stack>
        </Stack>
        <TableContainer sx={{ mt: 1.5 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Input</TableCell>
                <TableCell>Split</TableCell>
                <TableCell>Expected</TableCell>
                <TableCell>Latest evidence</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((item) => (
                <TableRow
                  hover
                  key={item.id}
                  onClick={() => onOpenCase(item)}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>
                      {item.question}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.id} · {item.metadata}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={item.split} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">{item.reference}</Typography>
                  </TableCell>
                  <TableCell>
                    <OutcomeChip status={item.status} />
                  </TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography
                      color="text.secondary"
                      sx={{ py: 4, textAlign: "center" }}
                    >
                      No items match your search.
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
  onOpenCase: PropTypes.func.isRequired,
  onVersion: PropTypes.func.isRequired,
};

function VersionsView({ onOpenVersion }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Box>
            <Typography variant="h6" fontWeight={800}>
              Version history
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Immutable snapshots keep experiment evidence reproducible.
            </Typography>
          </Box>
          <Button variant="contained">Create version</Button>
        </Stack>
        <TableContainer sx={{ mt: 1.5 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Version</TableCell>
                <TableCell>Items</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Schema</TableCell>
                <TableCell align="right"> </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {VERSIONS.map((version) => (
                <TableRow hover key={version.id}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={750}>
                      {version.id}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {version.hash}
                    </Typography>
                  </TableCell>
                  <TableCell>{version.items.toLocaleString()}</TableCell>
                  <TableCell>{version.source}</TableCell>
                  <TableCell>{version.created}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={version.schema}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => onOpenVersion(version)}>
                      Inspect
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}
VersionsView.propTypes = { onOpenVersion: PropTypes.func.isRequired };

function EvaluatorsView() {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack direction="row" justifyContent="space-between">
          <Box>
            <Typography variant="h6" fontWeight={800}>
              Evaluators
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Pinned evaluator versions are applied to each run and remain
              comparable.
            </Typography>
          </Box>
          <Button variant="outlined">Manage evaluators</Button>
        </Stack>
        <TableContainer sx={{ mt: 1.5 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Evaluator</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Mapping</TableCell>
                <TableCell>Runs</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {EVALUATORS.map((evaluator) => (
                <TableRow hover key={evaluator.name}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={750}>
                      {evaluator.name} · {evaluator.version}
                    </Typography>
                  </TableCell>
                  <TableCell>{evaluator.type}</TableCell>
                  <TableCell>{evaluator.mapped}</TableCell>
                  <TableCell>{evaluator.runs}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color="success"
                      variant="outlined"
                      label={evaluator.state}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

export default function DatasetExperimentsMock() {
  const [tab, setTab] = useState("runs");
  const [runs, setRuns] = useState(INITIAL_RUNS);
  const [selectedIds, setSelectedIds] = useState(["run-001", "run-002"]);
  const [baselineId, setBaselineId] = useState("run-001");
  const [candidateId, setCandidateId] = useState("run-002");
  const [compareVisible, setCompareVisible] = useState(true);
  const [selectedCase, setSelectedCase] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [falconOpen, setFalconOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === candidateId),
    [candidateId, runs],
  );
  const handleToggle = (id) =>
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length < 2
          ? [...current, id]
          : current,
    );
  const handleCreateRun = (payload) => {
    const id = `run-${runs.length + 1}`;
    setRuns((current) => [
      {
        ...INITIAL_RUNS[3],
        ...payload,
        id,
        name: payload.name || "New experiment run",
        status: "Queued",
        progress: 0,
        completed: 0,
        created: "Just now",
        compatible: true,
      },
      ...current,
    ]);
    setNotice(
      "Run created and queued. The run list will update as items complete (mock).",
    );
    setTab("runs");
  };
  const handleFalcon = (message) => {
    setNotice(message);
    setFalconOpen(false);
    if (message === "Run a new experiment") setWizardOpen(true);
  };

  return (
    <>
      <Helmet>
        <title>{DATASET.name} · Datasets</title>
      </Helmet>
      <HeaderComponent
        links={[{ name: "Datasets", href: "/" }, { name: DATASET.name }]}
        routeDepth={2}
      />
      <Box
        sx={{
          bgcolor: "background.neutral",
          minHeight: "calc(100vh - 70px)",
          px: { xs: 2, md: 4 },
          py: { xs: 2, md: 3 },
        }}
      >
        <Box sx={{ maxWidth: 1500, mx: "auto" }}>
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
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={DATASET.version}
                />
                <Chip
                  size="small"
                  color="success"
                  variant="outlined"
                  label="Pinned"
                />
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
                startIcon={
                  <Iconify icon="solar:download-minimalistic-linear" />
                }
                onClick={() =>
                  setNotice("Export started for Support questions v12 (mock).")
                }
              >
                Export
              </Button>
              <Button
                variant="outlined"
                startIcon={<Iconify icon="solar:bolt-linear" />}
                onClick={() => setFalconOpen(true)}
              >
                Falcon
              </Button>
              <Button
                variant="contained"
                startIcon={<Iconify icon="solar:add-circle-linear" />}
                onClick={() => setWizardOpen(true)}
              >
                New run
              </Button>
            </Stack>
          </Stack>
          {notice && (
            <Alert
              severity="success"
              onClose={() => setNotice("")}
              sx={{ mt: 2 }}
            >
              {notice}
            </Alert>
          )}
          <Tabs
            value={tab}
            onChange={(_, value) => setTab(value)}
            sx={{ mt: 2.5, borderBottom: 1, borderColor: "divider" }}
          >
            <Tab
              value="items"
              label={`Items ${DATASET.count.toLocaleString()}`}
            />
            <Tab value="runs" label={`Runs ${runs.length}`} />
            <Tab value="versions" label="Versions" />
            <Tab value="evaluators" label="Evaluators" />
          </Tabs>
          <Box sx={{ mt: 2 }}>
            {tab === "items" && (
              <ItemsView
                onOpenCase={setSelectedCase}
                onVersion={() => setSelectedVersion(VERSIONS[0])}
              />
            )}
            {tab === "versions" && (
              <VersionsView onOpenVersion={setSelectedVersion} />
            )}
            {tab === "evaluators" && <EvaluatorsView />}
            {tab === "runs" && (
              <RunsView
                runs={runs}
                selectedIds={selectedIds}
                baselineId={baselineId}
                candidateId={candidateId}
                onToggle={handleToggle}
                onBaseline={(id) => {
                  setBaselineId(id);
                  setSelectedIds((current) =>
                    current.includes(id) ? current : [...current.slice(-1), id],
                  );
                }}
                onCandidate={(id) => {
                  setCandidateId(id);
                  setSelectedIds((current) =>
                    current.includes(id) ? current : [...current.slice(-1), id],
                  );
                }}
                onCompare={() => setCompareVisible(true)}
                compareVisible={compareVisible}
                search={search}
                setSearch={setSearch}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                onOpenCase={setSelectedCase}
              />
            )}
          </Box>
        </Box>
      </Box>
      <CaseDrawer
        item={selectedCase}
        items={CASES}
        onClose={() => setSelectedCase(null)}
        onNavigate={setSelectedCase}
      />
      <VersionDrawer
        version={selectedVersion}
        onClose={() => setSelectedVersion(null)}
        onCreate={() => {
          setNotice("Child dataset version draft created (mock).");
          setSelectedVersion(null);
        }}
      />
      <FalconDrawer
        open={falconOpen}
        onClose={() => setFalconOpen(false)}
        onAction={handleFalcon}
      />
      <RunWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreate={handleCreateRun}
      />
      {selectedRun && null}
    </>
  );
}
