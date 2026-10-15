import { buildJevMapping } from "src/sections/evals/utils/jevMapping";

export const INSTANT_EVAL_TAG = "instant-eval";
export const INSTANT_EVAL_MODEL = "jev-latest";
export const YES_NO_LABELS = ["Yes", "No"];
export const TRACE_LIMIT_OPTIONS = [50, 100, 200, 500];
export const MAX_QUESTION_LENGTH = 2000;
export const MAX_CATEGORIES = 10;
export const MAX_QUESTIONS = 5;

export const ANSWER_TYPES = {
  YES_NO: "yes_no",
  CATEGORY: "category",
};

// What Jev reads from each trace. Values are the root span fields the eval
// mapping resolves (input -> input.value, output -> output.value).
export const READS = {
  input_output: {
    label: "Input and output",
    variables: ["input", "output"],
  },
  input: { label: "Input only", variables: ["input"] },
  output: { label: "Output only", variables: ["output"] },
};

const VARIABLE_LABELS = {
  input: "Trace input",
  output: "Trace output",
};

export const cleanCategories = (categories = []) => {
  const seen = new Set();
  return categories
    .map((category) => (typeof category === "string" ? category.trim() : ""))
    .filter((category) => {
      const key = category.toLowerCase();
      if (!category || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const answerLabels = ({ answerType, categories }) =>
  answerType === ANSWER_TYPES.CATEGORY
    ? cleanCategories(categories)
    : YES_NO_LABELS;

export function validateInstantEval({ question, answerType, categories }) {
  const text = (question || "").trim();
  if (!text) return "Write the question Jev should answer for each trace.";
  if (text.length > MAX_QUESTION_LENGTH)
    return `Keep the question under ${MAX_QUESTION_LENGTH} characters.`;
  if (answerType === ANSWER_TYPES.CATEGORY) {
    const labels = cleanCategories(categories);
    if (labels.length < 2) return "Add at least two categories.";
    if (labels.length > MAX_CATEGORIES)
      return `Use at most ${MAX_CATEGORIES} categories.`;
    if (labels.some((label) => label.length > 200))
      return "Keep each category under 200 characters.";
  }
  return null;
}

// Template names allow only lowercase letters, numbers, "-" and "_", and are
// unique per workspace, so a time suffix keeps repeated questions distinct.
export function evaluatorName(question, now = new Date()) {
  const slug = question
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join("-");
  const stamp = now.toISOString().replace(/\D/g, "").slice(4, 14);
  return `${slug || "instant-eval"}-${stamp}`.slice(0, 255);
}

export function buildInstructions(question, reads) {
  const variables = READS[reads]?.variables || READS.input_output.variables;
  const context = variables
    .map((variable) => `${VARIABLE_LABELS[variable]}:\n{{${variable}}}`)
    .join("\n\n");
  return `${question.trim()}\n\n${context}`;
}

// Yes/No questions are a two-label choice so results read "Yes" / "No" in the
// grid and filters, rather than Passed/Failed. "Yes" scores 1, so the saved
// evaluator's pass rate is the share of traces where the answer was yes.
export function buildTemplatePayload({
  question,
  answerType,
  categories,
  reads,
  now,
}) {
  const labels = answerLabels({ answerType, categories });
  // Categories carry no pass/fail meaning, so each scores 1.
  const choiceScores = Object.fromEntries(
    labels.map((label) => [
      label,
      answerType === ANSWER_TYPES.CATEGORY || label === "Yes" ? 1 : 0,
    ]),
  );
  return {
    name: evaluatorName(question, now),
    eval_type: "llm",
    instructions: buildInstructions(question, reads),
    model: INSTANT_EVAL_MODEL,
    output_type: "deterministic",
    choice_scores: choiceScores,
    pass_threshold: 0.5,
    multi_choice: false,
    description: question.trim(),
    tags: [INSTANT_EVAL_TAG],
    template_format: "mustache",
    jev_mapping: buildJevMapping("deterministic", choiceScores),
  };
}

export const buildEvalMapping = (reads) =>
  Object.fromEntries(
    (READS[reads]?.variables || READS.input_output.variables).map(
      (variable) => [variable, variable],
    ),
  );
