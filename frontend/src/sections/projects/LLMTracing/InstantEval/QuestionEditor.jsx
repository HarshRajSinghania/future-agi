import React, { useState } from "react";
import PropTypes from "prop-types";
import {
  Box,
  Chip,
  IconButton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import Iconify from "src/components/iconify";
import {
  ANSWER_TYPES,
  MAX_CATEGORIES,
  MAX_QUESTION_LENGTH,
} from "./instantEvalPayloads";

function CategoryEditor({ categories, onChange }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value || categories.length >= MAX_CATEGORIES) return;
    onChange([...categories, value]);
    setDraft("");
  };
  return (
    <Box>
      {categories.length > 0 && (
        <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 1 }}>
          {categories.map((category, index) => (
            <Chip
              key={`${category}-${index}`}
              label={category}
              size="small"
              onDelete={() =>
                onChange(categories.filter((_, i) => i !== index))
              }
            />
          ))}
        </Stack>
      )}
      <TextField
        size="small"
        fullWidth
        placeholder={
          categories.length >= MAX_CATEGORIES
            ? `Up to ${MAX_CATEGORIES} categories`
            : "Type a category and press Enter"
        }
        value={draft}
        disabled={categories.length >= MAX_CATEGORIES}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add();
          }
        }}
        onBlur={add}
        inputProps={{ "aria-label": "Add category", maxLength: 200 }}
      />
    </Box>
  );
}

CategoryEditor.propTypes = {
  categories: PropTypes.arrayOf(PropTypes.string).isRequired,
  onChange: PropTypes.func.isRequired,
};

export default function QuestionEditor({
  index,
  value,
  error,
  onChange,
  onRemove,
  autoFocus,
}) {
  const update = (patch) => onChange({ ...value, ...patch });
  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: error ? "error.main" : "divider",
        borderRadius: 1,
        p: 1.5,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1 }}
      >
        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          Question {index + 1}
        </Typography>
        {onRemove && (
          <Tooltip title="Remove question">
            <IconButton
              size="small"
              onClick={onRemove}
              aria-label={`Remove question ${index + 1}`}
            >
              <Iconify icon="mdi:close" width={16} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      <TextField
        multiline
        minRows={2}
        fullWidth
        autoFocus={autoFocus}
        value={value.question}
        onChange={(event) => update({ question: event.target.value })}
        placeholder="Did the agent promise a refund without checking the order first?"
        error={Boolean(error)}
        helperText={error || " "}
        inputProps={{
          maxLength: MAX_QUESTION_LENGTH,
          "aria-label": `Question ${index + 1}`,
        }}
      />
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={value.answerType}
          onChange={(_, answerType) => answerType && update({ answerType })}
          aria-label={`Answer type for question ${index + 1}`}
        >
          <ToggleButton value={ANSWER_TYPES.YES_NO} sx={{ px: 1.5, py: 0.25 }}>
            Yes / No
          </ToggleButton>
          <ToggleButton
            value={ANSWER_TYPES.CATEGORY}
            sx={{ px: 1.5, py: 0.25 }}
          >
            Categories
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {value.answerType === ANSWER_TYPES.CATEGORY && (
        <Box sx={{ mt: 1.25 }}>
          <CategoryEditor
            categories={value.categories}
            onChange={(categories) => update({ categories })}
          />
        </Box>
      )}
    </Box>
  );
}

QuestionEditor.propTypes = {
  index: PropTypes.number.isRequired,
  value: PropTypes.shape({
    question: PropTypes.string,
    answerType: PropTypes.string,
    categories: PropTypes.arrayOf(PropTypes.string),
  }).isRequired,
  error: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func,
  autoFocus: PropTypes.bool,
};
