import { WORKSPACE_TABS } from "../workspace/workspace.constants";

// Build-stage copy for the deriving hero, the building tab rail and the builder
// console. Strings ported verbatim from the designer's DerivedPanels.jsx
// (deriving labels + tab rail) and AssistantConsole.jsx.

// The DerivingAnimation copy, one line per milestone the builder is working on,
// plus the loading branch once all three are done. Verbatim from DerivedPanels.
export const DERIVING_LABEL = {
  understand: "Reading your agent: extracting tools and rules",
  build: "Building the world: seeding data and wiring handlers",
  scenarios: "Writing scenarios: proving each one solvable",
  loading: "Loading the editor for what we derived",
  idle: "Reading your agent…",
  // Preflight already passed inline; this stage is the create call landing.
  creating: "Creating your environment…",
  // Terminal-failed build: the hero reads as failed (the specific reason shows
  // on the failed pipeline step below), not the raw stage name.
  failed: "Build failed: the environment couldn’t be assembled",
  // Terminal-canceled build: the user stopped it, so it reads as stopped rather
  // than failed (no step is at fault).
  canceled: "Build canceled: you stopped it before it finished",
  // Fallback for the source-panel header before a source label is known.
  readingSource: "reading source…",
};

// The tab rail on the building pane: the workspace tabs, rendered pointer-dead.
// Runs and Versions are left out — an environment that is still building (or
// failed to build) has no runs and no versions yet.
const NOT_WHILE_BUILDING = new Set(["runs", "versions"]);
export const BUILDING_TABS = WORKSPACE_TABS.filter((t) => !NOT_WHILE_BUILDING.has(t.id));

export const CONSOLE_COPY = {
  working: "Working on your last message…",
  idle: "Ask, correct, or steer what it builds",
  empty: "Answer the questions below to kick things off. You can also just start typing.",
  placeholder: "Reply to the builder…",
  attach: "Attach a dataset, CSV or file",
  attachAccept: ".csv,.tsv,.json,.jsonl,.xlsx,.txt,.md,.pdf",
  workingDot: "Working…",
  frozen: "Environment is still being built",
  stop: "Stop the current turn",
  collapse: "Collapse chat",
};

export const PIPELINE_CHECKS_COPY = {
  heading: "Setup: building the environment",
  queued: "queued",
};

// The nudge card in the chat: what changed (names only, never values) and
// whether to rebuild the environment or its scenarios.
export const NUDGE_COPY = {
  changed: (label) => `Agent ${label} changed`,
  available: (label) => `Agent ${label} is available`,
  notDefault: "It isn't this environment's default yet.",
  suiteChanged: (label) => `The environment changed (${label})`,
  source: {
    commit: (from, to) => `Commit ${from} → ${to}`,
    rolledBack: (to) => `Rolled back to commit ${to}`,
    archive: "New upload",
    provider: "Assistant changed",
    phone: "Phone number changed",
    livekit: "Agent name changed",
    other: "Source changed",
  },
  filesMore: (count) => `and ${count} more`,
  filesTruncated: "Only some of the changed files are listed.",
  filesUnavailable: (reason) => `File changes aren't available (${reason})`,
  unavailableReasons: {
    private_repository: "private repository",
    no_commit: "no commit recorded",
    repository_changed: "the repository changed",
    not_linear: "the history isn't linear",
    rate_limited: "GitHub's rate limit was reached",
    github_error: "GitHub couldn't be read",
    archive_missing: "the upload is missing",
    archive_unreadable: "the upload couldn't be read",
    archive_too_large: "the upload is too large",
  },
  promptChanged: "Prompt changed",
  variables: {
    added: "Added",
    removed: "Removed",
    changed: "Changed",
    unknown: "May have changed",
  },
  settingsChanged: (names) => `Settings changed: ${names.join(", ")}`,
  question: {
    environment: "Rebuild the environment?",
    suite: "Rebuild the scenarios?",
  },
  rebuild: "Rebuild",
  rebuildUnavailable: "Rebuild isn't available yet.",
  rebuildOff: "Rebuilding is turned off for this environment.",
  skip: "Skip",
  skipFor: (subject) => `Skip: ${subject}`,
  skipping: "Skipping…",
  skipError: "Couldn't skip. Try again.",
  // An answer the server refused, by error code.
  errors: {
    nudge_closed: "This update was already answered or closed.",
    nudge_not_found: "This update no longer exists.",
    nudges_disabled: "Rebuilding is turned off for this environment.",
    rebuild_unavailable: "Rebuild isn't available yet.",
  },
  states: {
    answered_no: "Skipped. The current version stays.",
    no_change: "No change needed",
    failed: "Closed",
    queued: "Rebuild queued",
    running: "Rebuilding…",
    applied: "Rebuilt",
  },
  replacedByAgent: (label) => `Replaced by agent ${label}`,
  replacedByEnvironment: (label) => `Replaced by environment ${label}`,
  replacedSameTrigger: "Updated for a newer environment version",
  replaced: "Replaced by a newer update",
};
