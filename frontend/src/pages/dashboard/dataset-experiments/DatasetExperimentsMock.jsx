import React, { useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from "@mui/material";
import { Helmet } from "react-helmet-async";
import Iconify from "src/components/iconify";
import { HeaderComponent } from "src/sections/HeaderComponent";

const STEPS = ["Choose data", "Run agent", "Compare answers", "Decide"];

const DATASETS = [
  {
    id: "support-v12",
    name: "Support questions",
    version: "Version 12",
    detail: "1,248 real customer questions",
    note: "Newest version · ready to use",
  },
  {
    id: "support-v11",
    name: "Support questions",
    version: "Version 11",
    detail: "1,124 real customer questions",
    note: "Previous version · use as a baseline",
  },
];

const AGENTS = [
  {
    id: "refund-agent",
    name: "Refund assistant",
    detail: "Looks up an order and explains refund options.",
    model: "GPT-4.1 mini",
  },
  {
    id: "support-agent",
    name: "Support assistant",
    detail: "Answers questions using your support articles.",
    model: "Claude Sonnet",
  },
];

const CHANGED_CASES = [
  {
    id: "refund-014",
    question: "Can I return an opened item?",
    result: "Improved",
    detail: "The new answer explains the 30-day exception clearly.",
  },
  {
    id: "cancel-031",
    question: "How do I cancel my plan?",
    result: "Needs review",
    detail: "The new answer says 14 days; the old answer said 30 days.",
  },
  {
    id: "invoice-027",
    question: "Why is my invoice different?",
    result: "Unchanged",
    detail: "Both agents gave the same useful explanation.",
  },
];

function ChoiceCard({ checked, children, onClick }) {
  return (
    <Card
      variant="outlined"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      sx={{
        borderColor: checked ? "primary.main" : "divider",
        bgcolor: checked ? "primary.50" : "background.paper",
        transition: "border-color 120ms ease, background-color 120ms ease",
      }}
    >
      {children}
    </Card>
  );
}

ChoiceCard.propTypes = {
  checked: PropTypes.bool.isRequired,
  children: PropTypes.node.isRequired,
  onClick: PropTypes.func.isRequired,
};

function PageHeader({ step, onStartOver }) {
  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={1.5}
      >
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="h5" fontWeight={700}>
              Test an agent
            </Typography>
            <Chip
              size="small"
              label="Example data"
              color="warning"
              variant="outlined"
            />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Follow four simple steps to see whether a new agent is ready.
          </Typography>
        </Box>
        {step > 0 && (
          <Button size="small" onClick={onStartOver}>
            Start over
          </Button>
        )}
      </Stack>
      <Stepper
        activeStep={step}
        alternativeLabel
        sx={{
          "& .MuiStepLabel-label": { fontSize: { xs: 11, sm: 13 } },
        }}
      >
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>
    </Stack>
  );
}

PageHeader.propTypes = {
  step: PropTypes.number.isRequired,
  onStartOver: PropTypes.func.isRequired,
};

function StepTitle({ eyebrow, title, children }) {
  return (
    <Box>
      <Typography
        variant="overline"
        color="primary.main"
        fontWeight={700}
        letterSpacing={0.8}
      >
        {eyebrow}
      </Typography>
      <Typography variant="h6" fontWeight={700} sx={{ mt: 0.25 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {children}
      </Typography>
    </Box>
  );
}

function ContextSummary({ dataset, agent }) {
  return (
    <Card variant="outlined" sx={{ bgcolor: "grey.50" }}>
      <CardContent sx={{ py: 1.25, "&:last-child": { pb: 1.25 } }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={{ xs: 0.5, sm: 2 }}
        >
          <Typography variant="caption" color="text.secondary">
            Data:{" "}
            <strong>
              {dataset.name} · {dataset.version}
            </strong>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Agent: <strong>{agent.name}</strong>
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

ContextSummary.propTypes = {
  dataset: PropTypes.shape({
    name: PropTypes.string.isRequired,
    version: PropTypes.string.isRequired,
  }).isRequired,
  agent: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    model: PropTypes.string.isRequired,
    detail: PropTypes.string.isRequired,
  }).isRequired,
};

StepTitle.propTypes = {
  eyebrow: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
};

function FooterAction({
  backLabel = "Back",
  onBack,
  actionLabel,
  onAction,
  disabled,
  actionVariant = "contained",
}) {
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="center"
      spacing={2}
      sx={{ mt: 3 }}
    >
      <Button variant="text" onClick={onBack} disabled={!onBack}>
        {backLabel}
      </Button>
      <Button variant={actionVariant} onClick={onAction} disabled={disabled}>
        {actionLabel}
      </Button>
    </Stack>
  );
}

FooterAction.propTypes = {
  backLabel: PropTypes.string,
  onBack: PropTypes.func,
  actionLabel: PropTypes.string.isRequired,
  onAction: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  actionVariant: PropTypes.oneOf(["contained", "outlined", "text"]),
};

function ChooseData({ selected, setSelected, onNext }) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <StepTitle eyebrow="Step 1 of 4" title="What should we test?">
          Choose one saved version of your questions. Every run uses this exact
          list, so you can compare it later.
        </StepTitle>
        <FormControl component="fieldset" fullWidth sx={{ mt: 2.5 }}>
          <FormLabel component="legend" sx={{ mb: 1, color: "text.primary" }}>
            Dataset version
          </FormLabel>
          <RadioGroup
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <Stack spacing={1.25}>
              {DATASETS.map((dataset) => (
                <ChoiceCard
                  key={dataset.id}
                  checked={selected === dataset.id}
                  onClick={() => setSelected(dataset.id)}
                >
                  <FormControlLabel
                    value={dataset.id}
                    control={<Radio />}
                    sx={{
                      m: 0,
                      p: 1.25,
                      width: "100%",
                      alignItems: "flex-start",
                    }}
                    label={
                      <Box sx={{ pt: 0.15 }}>
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          flexWrap="wrap"
                        >
                          <Typography variant="subtitle2" fontWeight={700}>
                            {dataset.name}
                          </Typography>
                          <Chip
                            size="small"
                            label={dataset.version}
                            variant="outlined"
                          />
                        </Stack>
                        <Typography variant="body2" sx={{ mt: 0.35 }}>
                          {dataset.detail}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {dataset.note}
                        </Typography>
                      </Box>
                    }
                  />
                </ChoiceCard>
              ))}
            </Stack>
          </RadioGroup>
        </FormControl>
        <FooterAction
          actionLabel="Use this dataset"
          onAction={onNext}
          disabled={!selected}
        />
      </CardContent>
    </Card>
  );
}

ChooseData.propTypes = {
  selected: PropTypes.string.isRequired,
  setSelected: PropTypes.func.isRequired,
  onNext: PropTypes.func.isRequired,
};

function RunAgent({
  selectedAgent,
  setSelectedAgent,
  dataset,
  agent,
  runState,
  onRun,
  onBack,
  onNext,
}) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <StepTitle eyebrow="Step 2 of 4" title="Which agent should we run?">
          Pick the agent you want to check. We will run it on all{" "}
          {dataset.detail.toLowerCase()}.
        </StepTitle>
        <Box sx={{ mt: 2 }}>
          <ContextSummary dataset={dataset} agent={agent} />
        </Box>
        <FormControl component="fieldset" fullWidth sx={{ mt: 2.5 }}>
          <FormLabel component="legend" sx={{ mb: 1, color: "text.primary" }}>
            Agent
          </FormLabel>
          <RadioGroup
            value={selectedAgent}
            onChange={(event) => setSelectedAgent(event.target.value)}
          >
            <Stack spacing={1.25}>
              {AGENTS.map((agent) => (
                <ChoiceCard
                  key={agent.id}
                  checked={selectedAgent === agent.id}
                  onClick={() => setSelectedAgent(agent.id)}
                >
                  <FormControlLabel
                    value={agent.id}
                    control={<Radio />}
                    sx={{
                      m: 0,
                      p: 1.25,
                      width: "100%",
                      alignItems: "flex-start",
                    }}
                    label={
                      <Box sx={{ pt: 0.15 }}>
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          flexWrap="wrap"
                        >
                          <Typography variant="subtitle2" fontWeight={700}>
                            {agent.name}
                          </Typography>
                          <Chip
                            size="small"
                            label={agent.model}
                            variant="outlined"
                          />
                        </Stack>
                        <Typography variant="body2" sx={{ mt: 0.35 }}>
                          {agent.detail}
                        </Typography>
                      </Box>
                    }
                  />
                </ChoiceCard>
              ))}
            </Stack>
          </RadioGroup>
        </FormControl>
        {runState === "running" && (
          <Alert severity="info" sx={{ mt: 2.5 }}>
            Running the agent on each question… this takes about two minutes in
            a real run.
          </Alert>
        )}
        {runState === "done" && (
          <Alert severity="success" sx={{ mt: 2.5 }}>
            The example run finished. It checked 1,248 questions in about two
            minutes.
          </Alert>
        )}
        <FooterAction
          onBack={onBack}
          actionLabel={
            runState === "done"
              ? "Compare the answers"
              : runState === "running"
                ? "Running…"
                : "Run this agent"
          }
          onAction={runState === "done" ? onNext : onRun}
          disabled={!selectedAgent || runState === "running"}
        />
      </CardContent>
    </Card>
  );
}

RunAgent.propTypes = {
  selectedAgent: PropTypes.string.isRequired,
  setSelectedAgent: PropTypes.func.isRequired,
  dataset: PropTypes.shape({
    name: PropTypes.string.isRequired,
    version: PropTypes.string.isRequired,
    detail: PropTypes.string.isRequired,
  }).isRequired,
  agent: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    model: PropTypes.string.isRequired,
    detail: PropTypes.string.isRequired,
  }).isRequired,
  runState: PropTypes.oneOf(["idle", "running", "done"]).isRequired,
  onRun: PropTypes.func.isRequired,
  onBack: PropTypes.func.isRequired,
  onNext: PropTypes.func.isRequired,
};

function CompareRuns({
  comparison,
  setComparison,
  dataset,
  agent,
  onBack,
  onNext,
}) {
  const [selectedCase, setSelectedCase] = useState(CHANGED_CASES[1].id);
  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <StepTitle eyebrow="Step 3 of 4" title="Did the new agent improve?">
          We compare answers for the same questions. Green means the candidate
          improved; red means it needs another look.
        </StepTitle>
        <Box sx={{ mt: 2 }}>
          <ContextSummary dataset={dataset} agent={agent} />
        </Box>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ mt: 2.5 }}
        >
          <ChoiceCard
            checked={comparison === "v11-v12"}
            onClick={() => setComparison("v11-v12")}
          >
            <Box sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                Compare
              </Typography>
              <Typography variant="subtitle2" fontWeight={700}>
                Previous version → New version
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                v11 answers against v12 answers
              </Typography>
            </Box>
          </ChoiceCard>
          <ChoiceCard
            checked={comparison === "two-agents"}
            onClick={() => setComparison("two-agents")}
          >
            <Box sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                Compare
              </Typography>
              <Typography variant="subtitle2" fontWeight={700}>
                Two agents on the same data
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                Refund assistant against Support assistant
              </Typography>
            </Box>
          </ChoiceCard>
        </Stack>
        <Divider sx={{ my: 2.5 }} />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <Card variant="outlined" sx={{ flex: 1, bgcolor: "success.50" }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Answers improved
              </Typography>
              <Typography variant="h4" fontWeight={700} color="success.dark">
                8
              </Typography>
              <Typography variant="body2">
                The new answer was clearer or more correct.
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ flex: 1, bgcolor: "error.50" }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Answers got worse
              </Typography>
              <Typography variant="h4" fontWeight={700} color="error.dark">
                2
              </Typography>
              <Typography variant="body2">
                These questions need a human to review.
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                No meaningful change
              </Typography>
              <Typography variant="h4" fontWeight={700}>
                90
              </Typography>
              <Typography variant="body2">
                Both answers were equally useful.
              </Typography>
            </CardContent>
          </Card>
        </Stack>
        <Alert severity="info" sx={{ mt: 2.5 }}>
          This is mock data. A real run will show the exact questions and answer
          changes.
        </Alert>
        <Box sx={{ mt: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            Questions that changed
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.35, mb: 1 }}
          >
            Select a row to see why the answer changed.
          </Typography>
          <Stack spacing={1}>
            {CHANGED_CASES.map((item) => (
              <Card
                key={item.id}
                variant="outlined"
                role="button"
                tabIndex={0}
                onClick={() => setSelectedCase(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedCase(item.id);
                  }
                }}
                sx={{
                  cursor: "pointer",
                  borderColor:
                    selectedCase === item.id ? "primary.main" : "divider",
                }}
              >
                <CardContent sx={{ py: 1.25, "&:last-child": { pb: 1.25 } }}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1}
                    justifyContent="space-between"
                  >
                    <Box>
                      <Typography variant="body2" fontWeight={600}>
                        {item.question}
                      </Typography>
                      {selectedCase === item.id && (
                        <Typography variant="caption" color="text.secondary">
                          {item.detail}
                        </Typography>
                      )}
                    </Box>
                    <Chip
                      size="small"
                      label={item.result}
                      color={
                        item.result === "Improved"
                          ? "success"
                          : item.result === "Needs review"
                            ? "error"
                            : "default"
                      }
                      variant={
                        item.result === "Unchanged" ? "outlined" : "filled"
                      }
                    />
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Box>
        <FooterAction
          onBack={onBack}
          actionLabel="Review the decision"
          onAction={onNext}
          disabled={!comparison}
        />
      </CardContent>
    </Card>
  );
}

CompareRuns.propTypes = {
  comparison: PropTypes.string.isRequired,
  setComparison: PropTypes.func.isRequired,
  dataset: PropTypes.shape({
    name: PropTypes.string.isRequired,
    version: PropTypes.string.isRequired,
  }).isRequired,
  agent: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    model: PropTypes.string.isRequired,
    detail: PropTypes.string.isRequired,
  }).isRequired,
  onBack: PropTypes.func.isRequired,
  onNext: PropTypes.func.isRequired,
};

function Decide({ dataset, agent, onBack, onStartOver }) {
  const [reviewSent, setReviewSent] = useState(false);

  if (reviewSent) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Alert severity="success" sx={{ alignItems: "flex-start" }}>
            <Typography variant="subtitle1" fontWeight={700}>
              Sent to review
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              Two changed answers are now waiting in the review queue.
            </Typography>
          </Alert>
          <FooterAction
            onBack={onBack}
            actionLabel="Start another test"
            onAction={onStartOver}
            actionVariant="outlined"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <StepTitle eyebrow="Step 4 of 4" title="Is this ready to use?">
          Use this summary to choose what happens next. You can approve the
          candidate or send the two changed answers to a reviewer.
        </StepTitle>
        <Box sx={{ mt: 2 }}>
          <ContextSummary dataset={dataset} agent={agent} />
        </Box>
        <Card
          variant="outlined"
          sx={{ mt: 2.5, bgcolor: "success.50", borderColor: "success.200" }}
        >
          <CardContent>
            <Stack direction="row" spacing={1.25} alignItems="flex-start">
              <Iconify
                icon="solar:check-circle-bold"
                color="#2e7d32"
                width={24}
              />
              <Box>
                <Typography variant="subtitle1" fontWeight={700}>
                  Good to test further
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  98 of 100 example answers were the same or better. Two answers
                  changed and should be checked by a person.
                </Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>
        <Stack spacing={1.25} sx={{ mt: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            Recommended next step
          </Typography>
          <Button
            variant="contained"
            size="large"
            startIcon={<Iconify icon="solar:users-group-rounded-linear" />}
            onClick={() => setReviewSent(true)}
          >
            Send 2 changed answers for review
          </Button>
          <Typography
            variant="caption"
            color="text.secondary"
            textAlign="center"
          >
            A reviewer can approve or reject each answer before release.
          </Typography>
        </Stack>
        <FooterAction
          onBack={onBack}
          actionLabel="Run another comparison"
          onAction={onStartOver}
          actionVariant="outlined"
        />
      </CardContent>
    </Card>
  );
}

Decide.propTypes = {
  dataset: PropTypes.shape({
    name: PropTypes.string.isRequired,
    version: PropTypes.string.isRequired,
  }).isRequired,
  agent: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    model: PropTypes.string.isRequired,
    detail: PropTypes.string.isRequired,
  }).isRequired,
  onBack: PropTypes.func.isRequired,
  onStartOver: PropTypes.func.isRequired,
};

export default function DatasetExperimentsMock() {
  const [step, setStep] = useState(0);
  const [dataset, setDataset] = useState("support-v12");
  const [agent, setAgent] = useState("refund-agent");
  const [runState, setRunState] = useState("idle");
  const [comparison, setComparison] = useState("v11-v12");
  const selectedDataset = useMemo(
    () => DATASETS.find((item) => item.id === dataset) || DATASETS[0],
    [dataset],
  );
  const selectedAgent = useMemo(
    () => AGENTS.find((item) => item.id === agent) || AGENTS[0],
    [agent],
  );

  const startOver = () => {
    setStep(0);
    setRunState("idle");
  };

  return (
    <>
      <Helmet>
        <title>Test an agent</title>
      </Helmet>
      <HeaderComponent
        links={[
          { name: "Design review", href: "/" },
          { name: "Test an agent" },
        ]}
        routeDepth={2}
      />
      <Box
        sx={{
          minHeight: "100%",
          bgcolor: "background.paper",
          p: { xs: 2, md: 4 },
        }}
      >
        <Box sx={{ maxWidth: 900, mx: "auto" }}>
          <PageHeader step={step} onStartOver={startOver} />
          <Box sx={{ mt: 3 }}>
            {step === 0 && (
              <ChooseData
                selected={dataset}
                setSelected={setDataset}
                onNext={() => setStep(1)}
              />
            )}
            {step === 1 && (
              <RunAgent
                selectedAgent={agent}
                setSelectedAgent={setAgent}
                dataset={selectedDataset}
                agent={selectedAgent}
                runState={runState}
                onRun={() => {
                  setRunState("running");
                  window.setTimeout(() => setRunState("done"), 700);
                }}
                onBack={() => setStep(0)}
                onNext={() => setStep(2)}
              />
            )}
            {step === 2 && (
              <CompareRuns
                comparison={comparison}
                setComparison={setComparison}
                dataset={selectedDataset}
                agent={selectedAgent}
                onBack={() => setStep(1)}
                onNext={() => setStep(3)}
              />
            )}
            {step === 3 && (
              <Decide
                dataset={selectedDataset}
                agent={selectedAgent}
                onBack={() => setStep(2)}
                onStartOver={startOver}
              />
            )}
          </Box>
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            textAlign="center"
            sx={{ mt: 3 }}
          >
            Mock data for design review · Nothing here changes a real dataset or
            agent.
          </Typography>
        </Box>
      </Box>
    </>
  );
}
