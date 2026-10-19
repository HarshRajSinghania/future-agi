import React, { useEffect, useState } from "react";
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
import { paths } from "src/routes/paths";
import QuestionEditor from "../QuestionEditor";
import {
  MAX_QUESTIONS,
  readOption,
  readsFor,
  validateInstantEval,
} from "../instantEvalPayloads";
import ScopeFilterBar from "src/sections/projects/ScopeFilterBar";
import {
  defaultReads,
  draftsFromQuestions,
  emptyDraft,
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
  offeredSizes,
  useAskScope,
} from "./askPopulation";
import { creditAmount, creditWords, durationWords } from "./askFilter";
import { sourceViewTitle } from "./askLinks";
import { scopeWords } from "./askFormat";

const asDraft = (entry) => draftsFromQuestions([entry])[0];

const ALL = "all";

function ChoiceCard({
  selected,
  onSelect,
  title,
  detail,
  note,
  noteIsReason,
  disabled,
  children,
}) {
  // The note sits outside the radio, at full opacity: it can say why the
  // choice can't run (in full contrast) and hold the way forward (a smaller
  // sample, billing), which stays usable when the choice is not.
  return (
    <Paper
      variant="outlined"
      sx={{
        flex: 1,
        minWidth: 240,
        p: 1.5,
        borderRadius: 1.5,
        borderColor: selected ? "primary.main" : "divider",
        boxShadow: (theme) =>
          selected ? `inset 0 0 0 1px ${theme.palette.primary.main}` : "none",
      }}
    >
      <Box
        role="radio"
        aria-checked={selected}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onClick={disabled ? undefined : onSelect}
        onKeyDown={(event) => {
          // Only keys aimed at the radio itself: the size menu inside it
          // (portalled, but still bubbling through React) handles its own.
          if (event.target !== event.currentTarget) return;
          if (!disabled && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onSelect();
          }
        }}
        sx={{
          borderRadius: 1,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          "&:focus-visible": {
            outline: "2px solid",
            outlineColor: "primary.main",
            outlineOffset: 4,
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
      </Box>
      {note && (
        <Typography
          variant="caption"
          color={noteIsReason ? "text.primary" : "text.secondary"}
          component="p"
          sx={{ mt: noteIsReason ? 0.5 : 0, pl: 3 }}
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
  // The note says why the choice can't run, not just a hint.
  noteIsReason: PropTypes.bool,
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
  return `Reads ${upTo}${cost.rows.toLocaleString()} ${noun}${perUser} · ${creditWords(
    cost.credits,
  )} · ${durationWords(cost.seconds)}`;
};

const billingLink = (
  <Link component={RouterLink} to={paths.dashboard.settings.billing}>
    Open billing
  </Link>
);

// "This run needs about 6,000 credits; you have 1,200 left this month.
// Read a sample of 20,000 instead", or why billing stops every run.

function CreditNote({ cost, estimate, unit, onChoose }) {
  if (cost.blocked)
    return (
      <>
        {estimate.credit_check?.message}
        <Box component="span" sx={{ display: "block", mt: 0.25 }}>
          {billingLink}
        </Box>
      </>
    );
  const left = cost.creditsLeft || 0;
  const fits = cost.fitsSize || 0;
  return (
    <>
      This run needs {creditWords(cost.credits)}; you have{" "}
      {left >= 0.05 ? creditAmount(left) : "none"} left this month.
      <Box component="span" sx={{ display: "block", mt: 0.25 }}>
        {fits > 0 ? (
          <Link component="button" type="button" onClick={() => onChoose(fits)}>
            Read a sample of {fits.toLocaleString()} {unitMeta(unit).plural}{" "}
            instead
          </Link>
        ) : (
          billingLink
        )}
      </Box>
    </>
  );
}

CreditNote.propTypes = {
  cost: PropTypes.object.isRequired,
  estimate: PropTypes.object.isRequired,
  unit: PropTypes.string.isRequired,
  onChoose: PropTypes.func.isRequired,
};

function ScopeCard({
  projectId,
  unit,
  scope,
  from,
  startedFrom,
  population,
  onScopeChange,
  notice,
  onUseView,
  choice,
  sizes,
  shownSize,
  onChoose,
  questions,
}) {
  const meta = unitMeta(unit);
  const fixed = population.handedOver;
  const words = fixed ? scopeWords(from) : "";
  const { estimate } = population;
  const count = estimate?.population ?? 0;
  const sampled = choice !== ALL && sizes.length > 0;
  const sampleCost = choiceCost(estimate, shownSize, questions);
  const allCost = choiceCost(estimate, null, questions);
  const noun = count === 1 ? meta.noun : meta.plural;
  const counted = `${formatCount(count, estimate?.population_is_lower_bound)} ${noun}`;
  const headline = fixed
    ? `${formatCount(count)} selected ${noun}${words ? ` from ${words}` : ""}`
    : population.fallback
      ? `${counted}, the newest in the ${sourceViewTitle(unit)} view`
      : `${counted} in the ${sourceViewTitle(unit)} view`;
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
          {population.isLoading ? (
            <Skeleton variant="text" width={300} />
          ) : population.isError ? (
            <Typography variant="body2" color="error.main">
              The {meta.plural} in that view couldn&apos;t be counted.{" "}
              <Link
                component="button"
                type="button"
                onClick={() => population.refetch()}
              >
                Retry
              </Link>
            </Typography>
          ) : (
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  opacity: population.isUpdating ? 0.6 : 1,
                }}
              >
                {headline}
              </Typography>
              {(population.isUpdating || population.counting) && (
                <CircularProgress
                  size={12}
                  thickness={5}
                  aria-label={`Counting the ${meta.plural}`}
                />
              )}
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary" component="p">
            {population.tooMany
              ? `Only the first ${MAX_HANDOVER.toLocaleString()} rows handed over are read.`
              : population.fallback
                ? `The server can't count these filters, so Jev reads the newest ${count.toLocaleString()} the view shows.`
                : population.counting
                  ? `Still counting the ${meta.plural} these filters match; you can start now.`
                  : fixed
                    ? "Exactly the rows handed over."
                    : `Counted with the date range and filters above${
                        startedFrom ? `, started from ${startedFrom}` : ""
                      }.`}
            {fixed && onUseView && (
              <>
                {" "}
                <Link component="button" type="button" onClick={onUseView}>
                  Use the view&apos;s filters instead
                </Link>
              </>
            )}
          </Typography>
          {!fixed && (
            <Box sx={{ mt: 1.25 }}>
              <ScopeFilterBar
                projectId={projectId}
                unit={unit}
                scope={scope}
                onChange={onScopeChange}
              />
            </Box>
          )}
          {notice && (
            <Typography
              variant="caption"
              color="text.secondary"
              component="p"
              role="status"
              sx={{ mt: 0.75 }}
            >
              {notice}
            </Typography>
          )}
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
              noteIsReason={Boolean(sampleCost?.creditLimited)}
              note={
                sampleCost?.creditLimited ? (
                  <CreditNote
                    cost={sampleCost}
                    estimate={estimate}
                    unit={unit}
                    onChoose={onChoose}
                  />
                ) : null
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
            noteIsReason={!allCost?.allowed}
            note={
              allCost?.creditLimited ? (
                <CreditNote
                  cost={allCost}
                  estimate={estimate}
                  unit={unit}
                  onChoose={onChoose}
                />
              ) : !allCost?.allowed ? (
                `Over the ${estimate.max_rows.toLocaleString()}-row limit for one run. Read a sample, or narrow the filters.`
              ) : allCost.needsConfirm ? (
                "You confirm the credits before it starts."
              ) : null
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
  scope: PropTypes.object.isRequired,
  // Where rows handed over came from ("Past 7D").
  from: PropTypes.string,
  // Where the date and filters came from ("the Users view").
  startedFrom: PropTypes.string,
  population: PropTypes.object.isRequired,
  onScopeChange: PropTypes.func.isRequired,
  notice: PropTypes.node,
  onUseView: PropTypes.func,
  choice: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  sizes: PropTypes.arrayOf(PropTypes.number).isRequired,
  shownSize: PropTypes.number,
  onChoose: PropTypes.func.isRequired,
  questions: PropTypes.number.isRequired,
};

/**
 * A new question, full page: what Jev should answer about the rows of a view
 * (its date and filters, editable here, or the rows handed over), what it
 * reads of each, and whether to read a random sample or every row, with what
 * each costs. A run past the confirm size restates its credits before it
 * starts.
 */
export default function AskComposer({
  projectId,
  unit,
  seed,
  scope,
  onScopeChange,
  scopeNotice,
  onUseView,
  starting,
  error,
  onAsk,
}) {
  const meta = unitMeta(unit);
  const jev = useJevAvailability();
  const population = useAskScope({ projectId, unit, scope });
  const saved = useInstantEvals(projectId, { unit });
  const [questions, setQuestions] = useState(() =>
    seed?.questions?.length
      ? draftsFromQuestions(seed.questions)
      : [emptyDraft()],
  );
  const [reads, setReads] = useState(() => defaultReads(unit));
  // A sample of 1,000 above 1,000 rows, else every row, until one is picked.
  const [picked, setPicked] = useState(null);
  // The last sample size picked, offered again after a turn to every row.
  const [lastSample, setLastSample] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [touched, setTouched] = useState(false);
  const errors = questions.map((question) =>
    validateInstantEval(question, meta.noun),
  );
  const readChoices = readsFor(unit);
  const estimate = population.estimate;
  const filled = Math.max(1, questions.filter((q) => q.question.trim()).length);
  const sizes = offeredSizes(estimate, filled);
  // A pick the scope's new count no longer offers falls back to the default.
  const choice =
    picked === ALL || sizes.includes(picked)
      ? picked
      : defaultChoice(estimate) ?? ALL;
  const sampleSize = choice === ALL ? null : choice;
  const shownSize =
    sampleSize ??
    (sizes.includes(lastSample) ? lastSample : null) ??
    defaultChoice(estimate) ??
    sizes[0];
  const cost = choiceCost(estimate, sampleSize, filled);
  const count = estimate?.population ?? 0;
  // A confirm restates one scope's credits; a new date or filter retracts it.
  useEffect(() => {
    setConfirming(false);
  }, [scope]);

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
    if (population.isUpdating) return;
    if (cost.needsConfirm && !confirmed) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    const handedOver = population.handedOver;
    onAsk({
      questions,
      reads,
      // What the shown count is for: the scope, once settled.
      filters: population.filters,
      search: population.search,
      ids: population.ids,
      sampleSize,
      confirm: confirmed,
      handedOver,
      window: handedOver ? null : scope.window,
      datePreset: population.datePreset,
      label: population.label,
      rows: cost.rows,
    });
  };

  const showExamples = !questions.some((question) => question.question.trim());
  const recent = (saved.items || []).slice(0, 6);
  const nothingInView =
    !population.isLoading &&
    !population.isError &&
    !population.isUpdating &&
    Boolean(estimate) &&
    !count;

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
        scope={scope}
        from={seed?.label}
        startedFrom={
          seed ? seed.source || `the ${sourceViewTitle(unit)} view` : undefined
        }
        population={population}
        onScopeChange={onScopeChange}
        notice={scopeNotice}
        onUseView={onUseView}
        choice={choice}
        sizes={sizes}
        shownSize={shownSize}
        onChoose={(next) => {
          setPicked(next);
          if (next !== ALL) setLastSample(next);
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
          {population.handedOver
            ? `None of the ${meta.plural} handed over can be read.`
            : `No ${meta.plural} match this date range and these filters. Widen the date range or remove a filter.`}
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
            population.isLoading ||
            population.isUpdating ||
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
            : population.isLoading || population.isUpdating
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
  // What the question reads (see observeScope), and its edits.
  scope: PropTypes.object.isRequired,
  onScopeChange: PropTypes.func.isRequired,
  // Why the scope changed on its own (filters a new unit can't use).
  scopeNotice: PropTypes.node,
  // Switch a selection handed over to the view's filters.
  onUseView: PropTypes.func,
  starting: PropTypes.bool,
  error: PropTypes.node,
  onAsk: PropTypes.func.isRequired,
};
