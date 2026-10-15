import React, { useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Link,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import axios, { endpoints } from "src/utils/axios";
import { getSafeActionErrorMessage } from "src/utils/errorUtils";
import {
  ANSWER_TYPES,
  MAX_CATEGORIES,
  MAX_DEFINITION_LENGTH,
  TRACE_LIMIT_OPTIONS,
} from "src/sections/projects/LLMTracing/InstantEval/instantEvalPayloads";
import { tracePageLink } from "./analyseScope";

export const OTHER_LABEL = "Other";
export const OTHER_DEFINITION =
  "None of the other categories clearly applies to this trace.";
export const DISCOVER_SAMPLE_SIZE = 120;
const MIN_SAMPLE = 10;
const LABEL_LENGTH = 40;

const GOALS = [
  {
    label: "What users ask for",
    focus: "What are users asking the assistant to do?",
  },
  {
    label: "Where it falls short",
    focus: "Where does the assistant fail to help the user, and how?",
  },
  {
    label: "How users feel",
    focus: "How does the user feel during the conversation, and why?",
  },
  { label: "Topics", focus: "Which topics or products come up?" },
];

// Evenly spaced across the scope's time order, so a busy hour cannot crowd
// out the rest of the window.
export function sampleEvenly(traces, size = DISCOVER_SAMPLE_SIZE) {
  const ordered = [...traces].sort(
    (a, b) => new Date(a.time) - new Date(b.time),
  );
  if (ordered.length <= size) return ordered.map((trace) => trace.traceId);
  return Array.from(
    { length: size },
    (_, index) =>
      ordered[Math.round((index * (ordered.length - 1)) / (size - 1))].traceId,
  );
}

export function validateProposal({ question, categories }) {
  if (!question.trim()) return "Write the question Jev should answer.";
  const labels = categories.map((category) => category.label.trim());
  if (labels.some((label) => !label)) return "Every category needs a name.";
  if (labels.length < 2) return "Keep at least two categories.";
  if (labels.length > MAX_CATEGORIES - 1)
    return `Use at most ${MAX_CATEGORIES - 1} categories (Other is added for you).`;
  const keys = labels.map((label) => label.toLowerCase());
  if (new Set(keys).size !== keys.length) return "Category names must differ.";
  if (keys.includes(OTHER_LABEL.toLowerCase()))
    return "Other is added automatically; rename that category.";
  if (
    categories.some(
      (category) => category.definition.length > MAX_DEFINITION_LENGTH,
    )
  )
    return `Keep each definition under ${MAX_DEFINITION_LENGTH} characters.`;
  return null;
}

export function proposalToQuestion({ question, categories }) {
  const labels = categories.map((category) => category.label.trim());
  return {
    question: question.trim(),
    answerType: ANSWER_TYPES.CATEGORY,
    categories: [...labels, OTHER_LABEL],
    definitions: {
      ...Object.fromEntries(
        categories.map((category) => [
          category.label.trim(),
          category.definition.trim(),
        ]),
      ),
      [OTHER_LABEL]: OTHER_DEFINITION,
    },
  };
}

function CategoryCard({ category, sampleSize, projectId, onChange, onRemove }) {
  const share = sampleSize ? category.sampleCount / sampleSize : 0;
  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1.5,
        p: 1.5,
        bgcolor: "background.paper",
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          value={category.label}
          onChange={(event) =>
            onChange({ label: event.target.value.slice(0, LABEL_LENGTH) })
          }
          inputProps={{ "aria-label": "Category name" }}
          sx={{ flex: 1, "& input": { fontWeight: 600 } }}
        />
        {category.sampleCount != null && (
          <Tooltip title="Share of the sampled traces the proposal put here. Jev's answers give the real count.">
            <Chip
              size="small"
              variant="outlined"
              label={`≈${Math.round(share * 100)}% of sample`}
            />
          </Tooltip>
        )}
        <IconButton
          size="small"
          aria-label={`Remove ${category.label || "category"}`}
          onClick={onRemove}
        >
          <Iconify icon="mdi:close" width={16} />
        </IconButton>
      </Stack>
      <TextField
        size="small"
        fullWidth
        multiline
        minRows={2}
        value={category.definition}
        placeholder="When should Jev pick this category?"
        onChange={(event) => onChange({ definition: event.target.value })}
        inputProps={{ "aria-label": `Definition of ${category.label}` }}
        sx={{ mt: 1 }}
      />
      {category.examples?.length > 0 && (
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {category.examples.map((example) => (
            <Stack
              key={example.trace_id}
              direction="row"
              spacing={0.75}
              alignItems="flex-start"
            >
              <Iconify
                icon="mdi:format-quote-open"
                width={14}
                sx={{ color: "text.disabled", mt: 0.25, flexShrink: 0 }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ flex: 1 }}
              >
                {example.quote}
              </Typography>
              <Link
                href={tracePageLink(projectId, example.trace_id)}
                target="_blank"
                rel="noopener"
                variant="caption"
                sx={{ flexShrink: 0 }}
              >
                Trace
              </Link>
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}

CategoryCard.propTypes = {
  category: PropTypes.object.isRequired,
  sampleSize: PropTypes.number,
  projectId: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

export default function DiscoverComposer({
  projectId,
  scopeTraces,
  scopeCount,
  scopeLoading,
  onRun,
  disabled,
}) {
  const [focus, setFocus] = useState(GOALS[0].focus);
  const [state, setState] = useState({ step: "goal" });
  const [limit, setLimit] = useState(TRACE_LIMIT_OPTIONS[2]);
  const [touched, setTouched] = useState(false);

  const available = scopeTraces?.length || 0;
  const sampleSize = Math.min(DISCOVER_SAMPLE_SIZE, available);

  const discover = async () => {
    setState({ step: "reading" });
    try {
      const response = await axios.post(endpoints.project.analyseDiscover(), {
        project_id: projectId,
        trace_ids: sampleEvenly(scopeTraces),
        focus,
      });
      const proposal = response?.data?.result;
      setTouched(false);
      setState({
        step: "review",
        question: proposal.question,
        sampleSize: proposal.sample_size,
        unassigned: proposal.unassigned,
        categories: proposal.categories.map((category) => ({
          label: category.label,
          definition: category.definition,
          examples: category.examples,
          sampleCount: category.sample_count,
        })),
      });
    } catch (error) {
      setState({
        step: "goal",
        error: getSafeActionErrorMessage(
          error,
          "Discover could not read these traces. Try again.",
        ),
      });
    }
  };

  if (state.step === "reading")
    return (
      <Box
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1.5,
          p: 2.5,
        }}
      >
        <Typography variant="h6">Reading {sampleSize} traces…</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sampled evenly across the scope. Proposing categories usually takes
          under a minute.
        </Typography>
        <LinearProgress />
      </Box>
    );

  if (state.step === "review") {
    const error = validateProposal(state);
    const update = (index, patch) =>
      setState((prev) => ({
        ...prev,
        categories: prev.categories.map((category, i) =>
          i === index ? { ...category, ...patch } : category,
        ),
      }));
    const covered =
      scopeCount && !scopeCount.isLowerBound
        ? Math.min(scopeCount.total, limit)
        : limit;
    return (
      <Box
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1.5,
          p: 2.5,
          bgcolor: "background.paper",
        }}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
        >
          <Box>
            <Typography variant="h6">Review the categories</Typography>
            <Typography variant="body2" color="text.secondary">
              Proposed from {state.sampleSize} traces sampled across the scope.
              Edit names and definitions; Jev uses each definition to decide.
            </Typography>
          </Box>
          <Button
            size="small"
            onClick={discover}
            startIcon={<Iconify icon="mdi:refresh" width={14} />}
            sx={{ textTransform: "none", flexShrink: 0 }}
          >
            Discover again
          </Button>
        </Stack>

        <TextField
          fullWidth
          size="small"
          label="Question"
          value={state.question}
          onChange={(event) =>
            setState((prev) => ({ ...prev, question: event.target.value }))
          }
          sx={{ mt: 2 }}
        />

        <Box
          sx={{
            mt: 2,
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
            gap: 1.5,
          }}
        >
          {state.categories.map((category, index) => (
            <CategoryCard
              // Order is stable while editing; labels change as the user types.
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              category={category}
              sampleSize={state.sampleSize}
              projectId={projectId}
              onChange={(patch) => update(index, patch)}
              onRemove={() =>
                setState((prev) => ({
                  ...prev,
                  categories: prev.categories.filter((_, i) => i !== index),
                }))
              }
            />
          ))}
          <Box
            sx={(theme) => ({
              border: "1px dashed",
              borderColor: "divider",
              borderRadius: 1.5,
              p: 1.5,
              bgcolor: alpha(theme.palette.text.disabled, 0.04),
            })}
          >
            <Typography variant="body2" fontWeight={600}>
              {OTHER_LABEL}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Added automatically for traces that fit none of the above
              {state.unassigned
                ? ` (≈${Math.round((state.unassigned / state.sampleSize) * 100)}% of sample)`
                : ""}
              .
            </Typography>
            <Box>
              <Button
                size="small"
                disabled={state.categories.length >= MAX_CATEGORIES - 1}
                startIcon={<Iconify icon="mdi:plus" width={14} />}
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    categories: [
                      ...prev.categories,
                      {
                        label: "",
                        definition: "",
                        examples: [],
                        sampleCount: null,
                      },
                    ],
                  }))
                }
                sx={{ mt: 1, textTransform: "none", px: 0.5 }}
              >
                Add category
              </Button>
            </Box>
          </Box>
        </Box>

        {touched && error && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ mt: 2.5 }}
        >
          <TextField
            select
            size="small"
            label="Traces"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            sx={{ minWidth: 140 }}
          >
            {TRACE_LIMIT_OPTIONS.map((value) => (
              <MenuItem key={value} value={value}>
                Up to {value}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            size="large"
            disabled={disabled}
            startIcon={<Iconify icon="mdi:play" width={18} />}
            onClick={() => {
              setTouched(true);
              if (error) return;
              onRun({
                questions: [proposalToQuestion(state)],
                reads: "input_output",
                limit,
              });
            }}
            sx={{ textTransform: "none" }}
          >
            Sort {covered.toLocaleString()} trace{covered === 1 ? "" : "s"} with
            Jev
          </Button>
          <Button
            onClick={() => setState({ step: "goal" })}
            sx={{ textTransform: "none" }}
          >
            Back
          </Button>
        </Stack>
      </Box>
    );
  }

  const tooFew = !scopeLoading && available < MIN_SAMPLE;
  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1.5,
        bgcolor: "background.paper",
        p: 2.5,
      }}
    >
      <Typography variant="h6">Discover what&apos;s in these traces</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Analyse reads a sample, proposes categories you can edit, then Jev sorts
        every trace into them. Each category becomes a filter in the Trace view
        and can keep sorting new traces.
      </Typography>
      {state.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {state.error}
        </Alert>
      )}
      <Stack
        direction="row"
        spacing={1}
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 1.5 }}
      >
        {GOALS.map((goal) => (
          <Chip
            key={goal.label}
            label={goal.label}
            color={focus === goal.focus ? "primary" : "default"}
            variant={focus === goal.focus ? "filled" : "outlined"}
            onClick={() => setFocus(goal.focus)}
          />
        ))}
      </Stack>
      <TextField
        fullWidth
        size="small"
        label="What do you want to understand?"
        value={focus}
        onChange={(event) => setFocus(event.target.value.slice(0, 500))}
      />
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 2 }}>
        <Button
          variant="contained"
          size="large"
          disabled={disabled || scopeLoading || tooFew}
          onClick={discover}
          startIcon={<Iconify icon="mdi:creation-outline" width={18} />}
          sx={{ textTransform: "none" }}
        >
          Discover categories
        </Button>
        <Typography variant="caption" color="text.secondary">
          {scopeLoading
            ? "Counting traces…"
            : tooFew
              ? `Discover needs at least ${MIN_SAMPLE} traces in scope.`
              : `Reads ${sampleSize} of the ${
                  scopeCount?.isLowerBound
                    ? `newest ${available.toLocaleString()}`
                    : available.toLocaleString()
                } traces in scope.`}
        </Typography>
      </Stack>
    </Box>
  );
}

DiscoverComposer.propTypes = {
  projectId: PropTypes.string.isRequired,
  scopeTraces: PropTypes.array,
  scopeCount: PropTypes.object,
  scopeLoading: PropTypes.bool,
  onRun: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};
