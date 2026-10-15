import { alpha } from "@mui/material/styles";
import { ANSWER_TYPES } from "../instantEvalPayloads";
import { ERROR_ANSWER, SKIPPED_ANSWER } from "../instantEvalAnswers";

// Categorical hues for category answers; the first is the brand accent.
export const CATEGORY_COLORS = [
  "#7857FC",
  "#0EA5E9",
  "#F59E0B",
  "#10B981",
  "#EF4444",
  "#EC4899",
  "#14B8A6",
  "#8B5CF6",
  "#F97316",
  "#64748B",
];

// One answer's color: Yes in the accent, No in grey, categories by position,
// failures and skips muted.
export function answerColor(item, answer, theme) {
  if (answer === ERROR_ANSWER) return alpha(theme.palette.error.main, 0.45);
  if (answer === SKIPPED_ANSWER) return theme.palette.grey[400];
  if (item.answerType === ANSWER_TYPES.CATEGORY) {
    const index = item.labels.indexOf(answer);
    return CATEGORY_COLORS[
      (index >= 0 ? index : item.labels.length) % CATEGORY_COLORS.length
    ];
  }
  return answer === "Yes"
    ? theme.palette.primary.main
    : theme.palette.grey[500];
}

// The distribution's entries in display order: labels, then failures, then
// skips.
export function distributionEntries(summary) {
  return [
    ...summary.labels.map((entry) => ({ ...entry, answer: entry.label })),
    ...(summary.errors.count
      ? [{ ...summary.errors, answer: ERROR_ANSWER, muted: true }]
      : []),
    ...(summary.skipped.count
      ? [{ ...summary.skipped, answer: SKIPPED_ANSWER, muted: true }]
      : []),
  ];
}
