import React, { useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Link,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import Iconify from "src/components/iconify";
import QuestionEditor from "../QuestionEditor";
import {
  MAX_QUESTIONS,
  readOption,
  readsFor,
  validateInstantEval,
} from "../instantEvalPayloads";
import {
  defaultReads,
  draftsFromQuestions,
  emptyDraft,
  filtersWindow,
  formatCount,
  unitMeta,
} from "../instantEvalUnits";
import { useInstantEvals } from "../useInstantEval";
import { useJevAvailability } from "../useJevAvailability";
import { EXAMPLES } from "./askExamples";
import {
  MAX_HANDOVER,
  choiceCost,
  defaultChoice,
  sampleSizes,
  useAskScope,
} from "./askPopulation";
import { creditWords, durationWords } from "./askFilter";
import { sourceViewLink, sourceViewTitle } from "./askLinks";
import { scopeWords } from "./askFormat";

const asDraft = (entry) => draftsFromQuestions([entry])[0];

const ALL = "all";

function ChoiceCard({
  selected,
  onSelect,
  title,
  detail,
  note,
  disabled,
  children,
}) {
  return (
    <Paper
      variant="outlined"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onSelect}
      onKeyDown={(event) => {
        if (!disabled && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onSelect();
        }
      }}
      sx={{
        flex: 1,
        minWidth: 240,
        p: 1.5,
        borderRadius: 1.5,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        borderColor: selected ? "primary.main" : "divider",
        boxShadow: (theme) =>
          selected ? `inset 0 0 0 1px ${theme.palette.primary.main}` : "none",
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
        },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Box
          aria-hidden
          sx={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            border: "2px solid",
            borderColor: selected ? "primary.main" : "text.disabled",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          {selected && (
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                bgcolor: "primary.main",
              }}
            />
          )}
        </Box>
        <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
          {title}
        </Typography>
        {children}
      </Stack>
      <Typography
        variant="caption"
        color="text.secondary"
        component="p"
        sx={{ mt: 0.5, pl: 3, fontVariantNumeric: "tabular-nums" }}
      >
        {detail}
      </Typography>
      {note && (
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ pl: 3 }}
        >
          {note}
        </Typography>
      )}
    </Paper>
  );
}

ChoiceCard.propTypes = {
  selected: PropTypes.bool,
  onSelect: PropTypes.func.isRequired,
  title: PropTypes.node.isRequired,
  detail: PropTypes.node,
  note: PropTypes.node,
  disabled: PropTypes.bool,
  children: PropTypes.node,
};

const costLine = (cost, unit, estimate) => {
  if (!cost) return "";
  const noun = unit === "users" ? "sessions" : unitMeta(unit).plural;
  const upTo = unit === "users" ? "up to " : "";
  const perUser = estimate?.sessions_per_user
    ? ` (${estimate.sessions_per_user} per user)`
    : "";
  // Set when the plan's rate, not Jev, decides how long a run takes.
  const planRate = estimate?.plan_rate_per_min;
  const pace = planRate
    ? ` (your plan answers ${Math.round(planRate).toLocaleString()} a minute)`
    : "";
  return `Reads ${upTo}${cost.rows.toLocaleString()} ${noun}${perUser} · ${creditWords(
    cost.credits,
  )} · ${durationWords(cost.seconds)}${pace}`;
};

// "Your plan has 300 Jev answers left; up to 150 sessions fit."
const quotaNote = (cost, unit) =>
  cost.fitsRows
    ? `More Jev answers than your plan has left; up to ${cost.fitsRows.toLocaleString()} ${unitMeta(unit).plural} fit.`
    : "Your plan has no Jev answers left for now.";

function ScopeCard({
  projectId,
  unit,
  seed,
  scope,
  choice,
  onChoose,
  questions,
}) {
  const meta = unitMeta(unit);
  const words = scopeWords(seed?.label);
  const { estimate } = scope;
  const count = estimate?.population ?? 0;
  const sizes = sampleSizes(estimate);
  const sampled = choice !== ALL && sizes.length > 0;
  const sampleSize = sampled ? choice : null;
  const shownSize = sampleSize ?? defaultChoice(estimate) ?? sizes[0];
  const sampleCost = choiceCost(estimate, shownSize, questions);
  const allCost = choiceCost(estimate, null, questions);
  const noun = count === 1 ? meta.noun : meta.plural;
  const source = scope.handedOver
    ? `handed over${words ? ` from ${words}` : ""}`
    : scope.fallback
      ? `, the newest in the ${sourceViewTitle(unit)} view`
      : `in the ${sourceViewTitle(unit)} view${words ? ` · ${words}` : ""}`;
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, borderRadius: 1.5, bgcolor: "background.neutral" }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Iconify
          icon="mdi:table-eye"
          width={20}
          sx={{ color: "text.secondary", mt: 0.25, flexShrink: 0 }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {scope.isLoading ? (
            <Skeleton variant="text" width={300} />
          ) : scope.isError ? (
            <Typography variant="body2" color="error.main">
              The {meta.plural} in that view couldn&apos;t be counted.{" "}
              <Link
                component="button"
                type="button"
                onClick={() => scope.refetch()}
              >
                Retry
              </Link>
            </Typography>
          ) : (
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
            >
              {formatCount(count, estimate?.population_is_lower_bound)} {noun}{" "}
              {source}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" component="p">
            {scope.tooMany
              ? `Only the first ${MAX_HANDOVER.toLocaleString()} rows handed over are read.`
              : scope.fallback
                ? `The server can't count these filters, so Jev reads the newest ${count.toLocaleString()} the view shows.`
                : scope.handedOver
                  ? "Exactly the rows handed over."
                  : "Counted with the view's own filters and date range."}{" "}
            <Link
              component={RouterLink}
              to={sourceViewLink(projectId, unit)}
              underline="hover"
            >
              Change them in {sourceViewTitle(unit)}
            </Link>
          </Typography>
        </Box>
      </Stack>
      {estimate && count > 0 && (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.25}
          role="radiogroup"
          aria-label="How many to read"
          sx={{ mt: 1.75 }}
        >
          {sizes.length > 0 && (
            <ChoiceCard
              selected={sampled}
              onSelect={() => onChoose(shownSize)}
              title={
                <>
                  A sample of{" "}
                  <Box
                    component="span"
                    sx={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {shownSize.toLocaleString()}
                  </Box>
                </>
              }
              detail={`${costLine(sampleCost, unit, estimate)}. Picked at random; the same rows each time.`}
              note={
                sampleCost?.quotaLimited ? quotaNote(sampleCost, unit) : null
              }
            >
              <TextField
                select
                size="small"
                variant="standard"
                value={shownSize}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onChoose(Number(event.target.value))}
                SelectProps={{
                  renderValue: () => "Change",
                  inputProps: { "aria-label": "Sample size" },
                }}
                sx={{ minWidth: 64, "& .MuiInput-input": { fontSize: 12 } }}
              >
                {sizes.map((size) => (
                  <MenuItem key={size} value={size}>
                    {size.toLocaleString()} {meta.plural}
                  </MenuItem>
                ))}
              </TextField>
            </ChoiceCard>
          )}
          <ChoiceCard
            selected={!sampled}
            onSelect={() => onChoose(ALL)}
            disabled={!allCost?.allowed}
            title={`${sizes.length ? "All " : "Every one of the "}${count.toLocaleString()}`}
            detail={costLine(allCost, unit, estimate)}
            note={
              allCost?.quotaLimited
                ? quotaNote(allCost, unit)
                : !allCost?.allowed
                  ? `Over the ${estimate.max_rows.toLocaleString()}-row limit for one run. Read a sample, or narrow the view.`
                  : allCost.needsConfirm
                    ? "You confirm the credits before it starts."
                    : null
            }
          />
        </Stack>
      )}
    </Paper>
  );
}

ScopeCard.propTypes = {
  projectId: PropTypes.string.isRequired,
  unit: PropTypes.string.isRequired,
  seed: PropTypes.object,
  scope: PropTypes.object.isRequired,
  choice: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onChoose: PropTypes.func.isRequired,
  questions: PropTypes.number.isRequired,
};

/**
 * A new question, full page: what Jev should answer about the rows of a view
 * (or the rows handed over), what it reads of each, and whether to read a
 * random sample or every row, with what each costs. A run past the confirm
 * size restates its credits before it starts.
 */
export default function AskComposer({
  projectId,
  unit,
  seed,
  starting,
  error,
  onAsk,
}) {
  const meta = unitMeta(unit);
  const jev = useJevAvailability();
  const scope = useAskScope({ projectId, unit, seed });
  const saved = useInstantEvals(projectId, { unit });
  const [questions, setQuestions] = useState(() =>
    seed?.questions?.length
      ? draftsFromQuestions(seed.questions)
      : [emptyDraft()],
  );
  const [reads, setReads] = useState(() => defaultReads(unit));
  // A sample of 1,000 above 1,000 rows, else every row, until one is picked.
  const [picked, setPicked] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [touched, setTouched] = useState(false);
  const errors = questions.map((question) =>
    validateInstantEval(question, meta.noun),
  );
  const readChoices = readsFor(unit);
  const estimate = scope.estimate;
  const choice = picked ?? defaultChoice(estimate) ?? ALL;
  const sampleSize = choice === ALL ? null : choice;
  const filled = Math.max(1, questions.filter((q) => q.question.trim()).length);
  const cost = choiceCost(estimate, sampleSize, filled);
  const count = estimate?.population ?? 0;

  const addQuestion = (entry) =>
    setQuestions((prev) => {
      const draft = asDraft(entry);
      const key = draft.question.trim().toLowerCase();
      if (prev.some((q) => q.question.trim().toLowerCase() === key))
        return prev;
      const blank = prev.findIndex((question) => !question.question.trim());
      if (blank >= 0) return prev.map((q, i) => (i === blank ? draft : q));
      if (prev.length >= MAX_QUESTIONS) return prev;
      return [...prev, draft];
    });

  const ask = (confirmed = false) => {
    setTouched(true);
    if (errors.some(Boolean) || !count || !cost?.allowed) return;
    if (cost.needsConfirm && !confirmed) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onAsk({
      questions,
      reads,
      filters: scope.filters,
      ids: scope.ids,
      sampleSize,
      confirm: confirmed,
      handedOver: scope.handedOver,
      window: filtersWindow(seed?.filters) || null,
      rows: cost.rows,
    });
  };

  const showExamples = !questions.some((question) => question.question.trim());
  const recent = (saved.items || []).slice(0, 6);
  const nothingInView =
    !scope.isLoading && !scope.isError && Boolean(estimate) && !count;

  return (
    <Stack spacing={3} sx={{ maxWidth: 880 }}>
      <Box>
        <Typography
          variant="h4"
          component="h1"
          sx={{ fontSize: 22, lineHeight: "30px", fontWeight: 600 }}
        >
          Ask Jev about these {meta.plural}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Jev reads every {meta.noun} and answers your question for each, in
          seconds. The answers land on a timeline as they come in.
        </Typography>
      </Box>

      {!jev.isLoading && !jev.available && (
        <Alert
          severity="info"
          action={
            jev.settingsPath && (
              <Button
                size="small"
                component={RouterLink}
                to={jev.settingsPath}
                sx={{ textTransform: "none" }}
              >
                Open AI Providers
              </Button>
            )
          }
        >
          {jev.reason}
        </Alert>
      )}

      <ScopeCard
        projectId={projectId}
        unit={unit}
        seed={seed}
        scope={scope}
        choice={choice}
        onChoose={(next) => {
          setPicked(next);
          setConfirming(false);
        }}
        questions={filled}
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
            variant="overline"
            color="text.secondary"
            component="h2"
            sx={{ display: "block", mb: 0.75 }}
          >
            Try one
          </Typography>
          <Stack direction="row" gap={0.75} flexWrap="wrap">
            {(EXAMPLES[unit] || EXAMPLES.traces).map((example) => (
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

      <Box sx={{ maxWidth: 432 }}>
        <TextField
          select
          fullWidth
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
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      {nothingInView && (
        <Alert severity="info">
          There are no {meta.plural} in that view to ask about. Widen its date
          range or filters in {sourceViewTitle(unit)}.
        </Alert>
      )}

      {confirming && cost && (
        <Alert
          severity="warning"
          icon={<Iconify icon="mdi:cash-check" width={20} />}
          action={
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => setConfirming(false)}>
                Back
              </Button>
              <Button
                size="small"
                variant="contained"
                color="warning"
                disabled={starting}
                onClick={() => ask(true)}
              >
                Start
              </Button>
            </Stack>
          }
        >
          Read {cost.rows.toLocaleString()} {meta.plural}? That is{" "}
          {creditWords(cost.credits)} for {filled} question
          {filled === 1 ? "" : "s"}, and takes {durationWords(cost.seconds)}.
          You can pause or cancel it while it runs.
        </Alert>
      )}

      <Box>
        <Button
          size="large"
          variant="contained"
          disabled={
            !jev.available ||
            jev.isLoading ||
            starting ||
            scope.isLoading ||
            nothingInView ||
            !cost?.allowed ||
            confirming
          }
          onClick={() => ask(false)}
          startIcon={
            starting ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <Iconify icon="mdi:creation-outline" width={18} />
            )
          }
        >
          {starting
            ? "Starting…"
            : scope.isLoading
              ? `Counting the ${meta.plural}…`
              : cost
                ? `Ask Jev about ${sampleSize ? "a sample of " : ""}${cost.rows.toLocaleString()} ${
                    unit === "users"
                      ? "sessions"
                      : cost.rows === 1
                        ? meta.noun
                        : meta.plural
                  }`
                : `Ask Jev`}
        </Button>
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ mt: 1, maxWidth: 640 }}
        >
          Each question is saved as a Jev evaluator you can reuse or edit. Every
          answer is billed as one eval run; TypeSafe bills its tokens to your
          own key.
        </Typography>
      </Box>

      {recent.length > 0 && (
        <Box>
          <Typography
            variant="overline"
            color="text.secondary"
            component="h2"
            sx={{ display: "block", mb: 0.75 }}
          >
            Recent questions
          </Typography>
          <Stack direction="row" gap={0.75} flexWrap="wrap">
            {recent.map((item) => (
              <Chip
                key={item.configId}
                size="small"
                variant="outlined"
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

AskComposer.propTypes = {
  projectId: PropTypes.string.isRequired,
  unit: PropTypes.oneOf(["traces", "spans", "sessions", "users"]).isRequired,
  seed: PropTypes.object,
  starting: PropTypes.bool,
  error: PropTypes.string,
  onAsk: PropTypes.func.isRequired,
};
