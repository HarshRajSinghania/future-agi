import PropTypes from "prop-types";
import { useEffect, useId, useRef } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";

import { REBUILD_AVAILABLE } from "src/api/simulate-environments/versions";
import { refusalText } from "../../workspace/evals/refusalText";
import { named } from "../../workspace/agents/agentVersionStatus";
import { NUDGE_COPY as COPY } from "../build.constants";

const MONO = "ui-monospace, Menlo, monospace";
const FILES_SHOWN = 8;
const SHORT_SHA = 7;

const short = (sha) => (sha ? String(sha).slice(0, SHORT_SHA) : "…");

// Why Rebuild can't be pressed, or null once it can.
const rebuildBlockedReason = (nudgesEnabled) => {
  if (!nudgesEnabled) return COPY.rebuildOff;
  return REBUILD_AVAILABLE ? null : COPY.rebuildUnavailable;
};

const answerErrorText = (error) =>
  COPY.errors[error?.error] || refusalText(error, COPY.skipError);

function sourceLine(source, reversed) {
  if (!source?.changed) return null;
  if (source.kind === "github") {
    return reversed
      ? COPY.source.rolledBack(short(source.to))
      : COPY.source.commit(short(source.from), short(source.to));
  }
  return COPY.source[source.kind] || COPY.source.other;
}

function stateText(nudge) {
  if (nudge.state !== "replaced")
    return COPY.states[nudge.state] || nudge.state;
  const by = nudge.replacedBy;
  if (!by?.triggerLabel) return COPY.replaced;
  if (nudge.target === "suite")
    return COPY.replacedByEnvironment(by.triggerLabel);
  return by.triggerLabel === nudge.triggerAgentVersion?.label
    ? COPY.replacedSameTrigger
    : COPY.replacedByAgent(by.triggerLabel);
}

const heading = (nudge) => {
  if (nudge.target === "suite") {
    return COPY.suiteChanged(named(nudge.baseEnvironmentVersion));
  }
  const label = named(nudge.triggerAgentVersion);
  return nudge.facts.agentDefaultMoved === false
    ? COPY.available(label)
    : COPY.changed(label);
};

const Line = ({ children, color = "text.secondary", mono }) => (
  <Typography
    sx={{ typography: "s3", color, ...(mono && { fontFamily: MONO }) }}
  >
    {children}
  </Typography>
);
Line.propTypes = {
  children: PropTypes.node,
  color: PropTypes.string,
  mono: PropTypes.bool,
};

function Files({ facts }) {
  const files = facts.changedFiles || [];
  if (facts.filesUnavailable) {
    const reason =
      COPY.unavailableReasons[facts.filesUnavailable] || facts.filesUnavailable;
    return <Line>{COPY.filesUnavailable(reason)}</Line>;
  }
  if (!files.length) return null;
  const rest = files.length - FILES_SHOWN;
  return (
    <Box component="ul" sx={{ m: 0, pl: 2 }}>
      {files.slice(0, FILES_SHOWN).map((file) => (
        <Box component="li" key={`${file.previousPath || ""}:${file.path}`}>
          <Line mono color="text.primary">
            {file.path} · {file.status}
            {file.additions != null && ` +${file.additions}`}
            {file.deletions != null && ` -${file.deletions}`}
          </Line>
        </Box>
      ))}
      {rest > 0 && (
        <Box component="li">
          <Line>{COPY.filesMore(rest)}</Line>
        </Box>
      )}
      {facts.filesTruncated && (
        <Box component="li">
          <Line>{COPY.filesTruncated}</Line>
        </Box>
      )}
    </Box>
  );
}
Files.propTypes = { facts: PropTypes.object.isRequired };

function Variables({ variables }) {
  const groups = ["added", "removed", "changed", "unknown"].filter(
    (group) => variables?.[group]?.length,
  );
  return groups.map((group) => (
    <Line key={group}>
      {COPY.variables[group]}: {variables[group].join(", ")}
    </Line>
  ));
}
Variables.propTypes = { variables: PropTypes.object };

// What changed, names only: the source line, files, prompt, variables and
// settings, or the environment's summary for a suite nudge.
export function NudgeFacts({ nudge }) {
  const { facts } = nudge;
  if (nudge.target === "suite") {
    return facts.environmentSummary ? (
      <Line>{facts.environmentSummary}</Line>
    ) : null;
  }
  const source = sourceLine(facts.source, facts.reversed);
  return (
    <Stack spacing={0.5}>
      {source && <Line>{source}</Line>}
      <Files facts={facts} />
      {facts.promptChanged && <Line>{COPY.promptChanged}</Line>}
      <Variables variables={facts.variables} />
      {facts.settingsChanged?.length > 0 && (
        <Line>{COPY.settingsChanged(facts.settingsChanged)}</Line>
      )}
    </Stack>
  );
}
NudgeFacts.propTypes = { nudge: PropTypes.object.isRequired };

// Rebuild (disabled, with its reason in plain text) and Skip for a pending
// nudge, shared by the chat card and the Agents panel.
export function NudgeActions({
  subject,
  nudgesEnabled = true,
  answering = false,
  error,
  onSkipNudge,
}) {
  const reasonId = useId();
  const blocked = rebuildBlockedReason(nudgesEnabled);
  return (
    <Stack spacing={0.75}>
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          variant="contained"
          disabled={Boolean(blocked) || answering}
          aria-describedby={blocked ? reasonId : undefined}
          sx={{ textTransform: "none" }}
        >
          {COPY.rebuild}
        </Button>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          disabled={answering || !onSkipNudge}
          onClick={onSkipNudge}
          aria-label={answering ? undefined : COPY.skipFor(subject)}
          sx={{ textTransform: "none" }}
        >
          {answering ? COPY.skipping : COPY.skip}
        </Button>
      </Stack>
      {blocked && (
        <Typography
          id={reasonId}
          sx={{ typography: "s3", color: "text.secondary" }}
        >
          {blocked}
        </Typography>
      )}
      {error && (
        <Typography role="alert" sx={{ typography: "s3", color: "error.main" }}>
          {answerErrorText(error)}
        </Typography>
      )}
    </Stack>
  );
}
NudgeActions.propTypes = {
  subject: PropTypes.string.isRequired,
  nudgesEnabled: PropTypes.bool,
  answering: PropTypes.bool,
  error: PropTypes.object,
  onSkipNudge: PropTypes.func,
};

// What became of a nudge. It takes focus after a Skip from here, so focus
// stays on the card and the new state is read out.
export function NudgeStateLine({ focus = false, onFocused, sx, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!focus) return;
    ref.current?.focus();
    onFocused?.();
  }, [focus, onFocused]);
  return (
    <Typography
      ref={ref}
      role="status"
      tabIndex={-1}
      sx={{ typography: "s2", color: "text.secondary", ...sx }}
    >
      {children}
    </Typography>
  );
}
NudgeStateLine.propTypes = {
  focus: PropTypes.bool,
  onFocused: PropTypes.func,
  sx: PropTypes.object,
  children: PropTypes.node,
};

// A nudge in the builder chat: its own system turn. Without the nudge itself
// (versioning off, or the list not loaded yet) the message's text stands in.
export default function NudgeCard({ turn }) {
  const { nudge } = turn;
  if (!nudge) {
    return (
      <Typography sx={{ typography: "s2", color: "text.secondary" }}>
        {turn.text}
      </Typography>
    );
  }
  const title = heading(nudge);
  const pending = nudge.state === "pending";
  return (
    <Box
      data-testid={`nudge-card-${nudge.id}`}
      component="section"
      aria-label={title}
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1.5,
        p: 1.5,
      }}
    >
      <Stack spacing={1}>
        <Box>
          <Typography sx={{ typography: "s2", fontWeight: "fontWeightBold" }}>
            {title}
          </Typography>
          {nudge.target === "environment" &&
            nudge.facts.agentDefaultMoved === false && (
              <Line>{COPY.notDefault}</Line>
            )}
        </Box>
        <NudgeFacts nudge={nudge} />
        {pending ? (
          <>
            <Typography sx={{ typography: "s2" }}>
              {COPY.question[nudge.target] || COPY.question.environment}
            </Typography>
            <NudgeActions
              subject={title}
              nudgesEnabled={turn.nudgesEnabled}
              answering={turn.answering}
              error={turn.error}
              onSkipNudge={turn.onSkipNudge}
            />
          </>
        ) : (
          <>
            <NudgeStateLine
              focus={turn.skipped}
              onFocused={turn.onSkippedFocused}
            >
              {stateText(nudge)}
            </NudgeStateLine>
            {turn.error && (
              <Typography
                role="alert"
                sx={{ typography: "s3", color: "error.main" }}
              >
                {answerErrorText(turn.error)}
              </Typography>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}
NudgeCard.propTypes = {
  turn: PropTypes.shape({
    id: PropTypes.string,
    text: PropTypes.string,
    nudge: PropTypes.object,
    nudgesEnabled: PropTypes.bool,
    answering: PropTypes.bool,
    skipped: PropTypes.bool,
    onSkippedFocused: PropTypes.func,
    error: PropTypes.object,
    onSkipNudge: PropTypes.func,
  }).isRequired,
};
