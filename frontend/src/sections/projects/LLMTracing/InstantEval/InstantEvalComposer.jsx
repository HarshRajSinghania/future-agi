import React, { useState } from "react";
import PropTypes from "prop-types";
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import Iconify from "src/components/iconify";
import QuestionEditor from "./QuestionEditor";
import {
  ANSWER_TYPES,
  MAX_QUESTIONS,
  readOption,
  readsFor,
  validateInstantEval,
} from "./instantEvalPayloads";
import {
  DEFAULT_LIMIT,
  LIMIT_OPTIONS,
  defaultReads,
  draftsFromQuestions,
  emptyDraft,
  limitHelp,
  limitOptionLabel,
  runButtonLabel,
  runCoverage,
  unitMeta,
} from "./instantEvalUnits";

const EXAMPLES = {
  traces: [
    {
      question:
        "Did the agent promise a refund without checking the order first?",
      answerType: ANSWER_TYPES.YES_NO,
    },
    {
      question: "Is the customer frustrated or upset?",
      answerType: ANSWER_TYPES.YES_NO,
    },
    {
      question: "What is the customer contacting support about?",
      answerType: ANSWER_TYPES.CATEGORY,
      categories: [
        "Refund",
        "Shipping",
        "Product question",
        "Account",
        "Other",
      ],
    },
  ],
  spans: [
    {
      question: "Did the model follow the system prompt?",
      answerType: ANSWER_TYPES.YES_NO,
    },
    {
      question: "Does the output make a claim the input doesn't support?",
      answerType: ANSWER_TYPES.YES_NO,
    },
    {
      question: "What kind of step is this?",
      answerType: ANSWER_TYPES.CATEGORY,
      categories: ["Planning", "Tool call", "Retrieval", "Answer", "Other"],
    },
  ],
  sessions: [
    {
      question: "Did the customer get what they came for?",
      answerType: ANSWER_TYPES.YES_NO,
    },
    {
      question: "Did the customer have to repeat themselves?",
      answerType: ANSWER_TYPES.YES_NO,
    },
    {
      question: "How did the conversation end?",
      answerType: ANSWER_TYPES.CATEGORY,
      categories: ["Resolved", "Handed to a human", "Abandoned", "Unclear"],
    },
  ],
  users: [
    {
      question: "Did the customer get what they came for?",
      answerType: ANSWER_TYPES.YES_NO,
    },
    {
      question: "Did the customer ask to speak to a human?",
      answerType: ANSWER_TYPES.YES_NO,
    },
    {
      question: "What did the customer come for?",
      answerType: ANSWER_TYPES.CATEGORY,
      categories: [
        "Order status",
        "Returns and refunds",
        "Product advice",
        "Account",
        "Other",
      ],
    },
  ],
};

const asDraft = (entry) => draftsFromQuestions([entry])[0];

function ScopeLine({ text, isLoading, isError, onRetry, onClearHandoff }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{
        px: 1.5,
        py: 1,
        borderRadius: 1,
        bgcolor: "background.neutral",
        minHeight: 40,
      }}
    >
      <Iconify
        icon="mdi:table-eye"
        width={16}
        sx={{ color: "text.secondary", flexShrink: 0 }}
      />
      {isError ? (
        <Typography variant="body2" color="error.main" sx={{ flex: 1 }}>
          Couldn&apos;t read the rows in this view.
          <Button
            size="small"
            onClick={onRetry}
            sx={{ textTransform: "none", minWidth: 0, py: 0, ml: 0.5 }}
          >
            Retry
          </Button>
        </Typography>
      ) : (
        <Typography
          variant="body2"
          color={isLoading ? "text.secondary" : "text.primary"}
          sx={{ flex: 1, minWidth: 0 }}
        >
          {text}
        </Typography>
      )}
      {onClearHandoff && (
        <Button
          size="small"
          onClick={onClearHandoff}
          sx={{ textTransform: "none", flexShrink: 0, py: 0 }}
        >
          Use the whole view
        </Button>
      )}
    </Stack>
  );
}

ScopeLine.propTypes = {
  text: PropTypes.string,
  isLoading: PropTypes.bool,
  isError: PropTypes.bool,
  onRetry: PropTypes.func,
  onClearHandoff: PropTypes.func,
};

export default function InstantEvalComposer({
  unit,
  initialQuestions,
  scopeText,
  population,
  handedOver,
  onClearHandoff,
  onRun,
  disabled,
  savedQuestions,
}) {
  const meta = unitMeta(unit);
  const [questions, setQuestions] = useState(() =>
    initialQuestions?.length ? initialQuestions : [emptyDraft()],
  );
  const [reads, setReads] = useState(() => defaultReads(unit));
  const [limit, setLimit] = useState(DEFAULT_LIMIT[unit]);
  const [touched, setTouched] = useState(false);
  const errors = questions.map((question) =>
    validateInstantEval(question, meta.noun),
  );

  // Fills the first blank question, or adds one.
  const addQuestion = (entry) =>
    setQuestions((prev) => {
      const draft = asDraft(entry);
      if (
        prev.some(
          (q) =>
            q.question.trim().toLowerCase() ===
            draft.question.trim().toLowerCase(),
        )
      )
        return prev;
      const blank = prev.findIndex((question) => !question.question.trim());
      if (blank >= 0) return prev.map((q, i) => (i === blank ? draft : q));
      if (prev.length >= MAX_QUESTIONS) return prev;
      return [...prev, draft];
    });

  const coverage = runCoverage({
    limit,
    population: population.data,
    handedOver,
  });

  const run = () => {
    setTouched(true);
    if (errors.some(Boolean)) return;
    onRun({ questions, reads, limit });
  };

  const showExamples = !questions.some((question) => question.question.trim());
  const recent = (savedQuestions || []).slice(0, 6);
  const readChoices = readsFor(unit);

  return (
    <Stack spacing={2.5}>
      <ScopeLine
        text={scopeText}
        isLoading={population.isLoading}
        isError={population.isError}
        onRetry={population.refetch}
        onClearHandoff={handedOver ? onClearHandoff : undefined}
      />

      <Stack spacing={1.25}>
        {questions.map((value, index) => (
          <QuestionEditor
            key={index}
            index={index}
            value={value}
            autoFocus={index === questions.length - 1}
            placeholder={EXAMPLES[unit]?.[0]?.question}
            error={touched ? errors[index] : null}
            onChange={(next) =>
              setQuestions((prev) =>
                prev.map((q, i) => (i === index ? next : q)),
              )
            }
            onRemove={
              questions.length > 1
                ? () =>
                    setQuestions((prev) => prev.filter((_, i) => i !== index))
                : undefined
            }
          />
        ))}
        <Stack direction="row" alignItems="center" spacing={1}>
          <Button
            size="small"
            startIcon={<Iconify icon="mdi:plus" width={16} />}
            disabled={questions.length >= MAX_QUESTIONS}
            onClick={() => setQuestions((prev) => [...prev, emptyDraft()])}
            sx={{ textTransform: "none" }}
          >
            Add another question
          </Button>
          <Typography variant="caption" color="text.secondary">
            Up to {MAX_QUESTIONS} in one pass
          </Typography>
        </Stack>
      </Stack>

      {showExamples && (
        <Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 0.75 }}
          >
            Try one
          </Typography>
          <Stack direction="row" gap={0.75} flexWrap="wrap">
            {EXAMPLES[unit].map((example) => (
              <Chip
                key={example.question}
                size="small"
                variant="outlined"
                label={example.question}
                onClick={() => addQuestion(example)}
                sx={{
                  maxWidth: "100%",
                  height: "auto",
                  "& .MuiChip-label": { whiteSpace: "normal", py: 0.5 },
                }}
              />
            ))}
          </Stack>
        </Box>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 1.5,
          alignItems: "start",
        }}
      >
        <TextField
          select
          size="small"
          label="Jev reads"
          value={reads}
          onChange={(event) => setReads(event.target.value)}
          helperText={readOption(unit, reads).hint}
          SelectProps={{
            renderValue: (value) => readOption(unit, value).label,
          }}
        >
          {readChoices.map((value) => (
            <MenuItem key={value} value={value} sx={{ display: "block" }}>
              <Typography variant="body2">
                {readOption(unit, value).label}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                component="p"
                sx={{ whiteSpace: "normal" }}
              >
                {readOption(unit, value).hint}
              </Typography>
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={unit === "users" ? "Users" : meta.title}
          value={limit}
          onChange={(event) => setLimit(Number(event.target.value))}
          helperText={limitHelp({ unit, limit })}
        >
          {LIMIT_OPTIONS[unit].map((value) => (
            <MenuItem key={value} value={value}>
              {limitOptionLabel(unit, value)}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      <Box>
        <Button
          fullWidth
          variant="contained"
          disabled={disabled}
          onClick={run}
          startIcon={<Iconify icon="mdi:play" width={18} />}
          sx={{ textTransform: "none" }}
        >
          {runButtonLabel({ unit, coverage })}
        </Button>
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ mt: 1 }}
        >
          Each question is saved as a Jev evaluator you can reuse or edit. Every
          answer is billed as one eval run; TypeSafe bills its tokens to your
          own key.
        </Typography>
      </Box>

      {recent.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
            Recent questions
          </Typography>
          <Stack direction="row" gap={0.75} flexWrap="wrap">
            {recent.map((item) => (
              <Chip
                key={item.configId}
                size="small"
                icon={<Iconify icon="mdi:history" width={14} />}
                label={item.question}
                title={item.question}
                onClick={() => {
                  addQuestion({
                    question: item.question,
                    answerType: item.answerType,
                    categories: item.labels,
                    definitions: item.definitions,
                  });
                  if (readChoices.includes(item.reads)) setReads(item.reads);
                }}
                sx={{ maxWidth: "100%" }}
              />
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

InstantEvalComposer.propTypes = {
  unit: PropTypes.oneOf(["traces", "spans", "sessions", "users"]).isRequired,
  initialQuestions: PropTypes.array,
  scopeText: PropTypes.string,
  population: PropTypes.shape({
    data: PropTypes.object,
    isLoading: PropTypes.bool,
    isError: PropTypes.bool,
    refetch: PropTypes.func,
  }).isRequired,
  handedOver: PropTypes.object,
  onClearHandoff: PropTypes.func,
  onRun: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  savedQuestions: PropTypes.array,
};
