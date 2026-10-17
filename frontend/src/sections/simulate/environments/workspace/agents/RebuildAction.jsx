import PropTypes from "prop-types";
import { Box, Typography } from "@mui/material";

import { NudgeActions } from "../../buildEnvironment/console/NudgeCard";
import { AGENT_VERSIONS_COPY } from "../workspace.constants";

const COPY = AGENT_VERSIONS_COPY.nudge;

// What the nudge would rebuild for, in counts: files, variables, prompt and
// settings. Names stay in the chat card.
const summary = (facts = {}) => {
  const files = facts.changedFiles?.length || 0;
  const variables = Object.values(facts.variables || {}).reduce(
    (total, names) => total + (names?.length || 0),
    0,
  );
  return [
    files && COPY.files(files),
    variables && COPY.variables(variables),
    facts.promptChanged && COPY.prompt,
    facts.settingsChanged?.length && COPY.settings,
  ]
    .filter(Boolean)
    .join(" · ");
};

// The environment nudge on its trigger version's row: a compact summary with
// Rebuild and Skip, answered through the same endpoint as the chat card.
export default function RebuildAction({
  nudge,
  label,
  nudgesEnabled,
  answering,
  error,
  onSkipNudge,
}) {
  const counts = summary(nudge.facts);
  return (
    <Box
      data-testid={`rebuild-action-${nudge.id}`}
      sx={{ mt: 1, pt: 1, borderTop: "1px solid", borderColor: "divider" }}
    >
      <Typography sx={{ typography: "s3", fontWeight: "fontWeightBold" }}>
        {COPY.title}
      </Typography>
      {counts && (
        <Typography sx={{ typography: "s3", color: "text.secondary", mb: 1 }}>
          {counts}
        </Typography>
      )}
      <NudgeActions
        subject={label}
        nudgesEnabled={nudgesEnabled}
        answering={answering}
        error={error}
        onSkipNudge={onSkipNudge}
      />
    </Box>
  );
}

RebuildAction.propTypes = {
  nudge: PropTypes.shape({
    id: PropTypes.string.isRequired,
    facts: PropTypes.object,
  }).isRequired,
  label: PropTypes.string.isRequired,
  nudgesEnabled: PropTypes.bool,
  answering: PropTypes.bool,
  error: PropTypes.object,
  onSkipNudge: PropTypes.func.isRequired,
};
