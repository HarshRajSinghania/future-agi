// Workspace shell copy and tab metadata, ported from the designer's
// EnvironmentWorkspace.jsx and DerivedPanels.jsx. Strings live here rather than
// inline so the shell, the build-page in-place swap and the tests share them.

// The workspace tabs, in rail order (matching the designer). Overview is first
// and is the default landing tab. Overview and Contract are views of the
// environment itself, so they carry no count badge; Scenarios, Evaluations and
// Runs badge the length of their matching env-state slice. Settings is last.
// The Overview tab id is "overview" (URL reads ?tab=overview), and its panel
// component/folder keep the OverviewPanel name.
export const WORKSPACE_TABS = [
  { id: "overview", label: "Overview", icon: "solar:widget-5-linear" },
  { id: "contract", label: "Contract", icon: "solar:document-text-linear" },
  { id: "scenarios", label: "Scenarios", icon: "solar:layers-minimalistic-linear", badge: "scenarios" },
  { id: "evals", label: "Evaluations", icon: "solar:shield-check-linear", badge: "evals" },
  { id: "runs", label: "Runs", icon: "solar:play-circle-linear", badge: "runs" },
  // Shown only when the environment has versioning switched on.
  { id: "versions", label: "Versions", icon: "solar:history-linear" },
  { id: "settings", label: "Settings", icon: "solar:settings-linear" },
];

// Setup-gap areas map onto the tab that owns the underlying answer, so a
// blocking gap surfaces as an amber dot on that tab. Only the areas the user
// can resolve inside this workspace are routed; the designer's Sandbox/Tools
// entries point at an Agents tab we do not render, so they are omitted.
export const GAP_AREA_TO_TAB = {
  Contract: "contract",
  Grading: "evals",
};

// Header, overflow-menu and empty-state copy for the workspace shell.
export const WORKSPACE_COPY = {
  back: "All environments",
  live: "Ready",
  buildingLabel: "Building",
  finalizingLabel: "Finalizing",
  failedLabel: "Failed",
  liveTooltip: "Environment is ready to run. You can edit via the builder or inline.",
  buildingTooltip: "Environment is still being built…",
  finalizingTooltip: "Wrapping up the build…",
  cancellingLabel: "Cancelling",
  cancellingTooltip: "Stopping the build and cleaning up its sandbox.",
  cancelledLabel: "Cancelled",
  cancelledTooltip: "You cancelled this build.",
  runningTooltip: "A simulation is running. Results land under Runs when it finishes.",
  failedTooltip: "This environment failed to build.",
  run: "Run simulation",
  moreActions: "More actions",
  fork: "Fork environment",
  forkHint: "Duplicate the world for a different agent or team. Agent + runs reset.",
  deleteEnv: "Delete environment",
  deleteEnvHint: "Remove this environment and cancel any live run. This can't be undone.",
  notFound: {
    title: "Environment not found",
    body: "It may have been removed from your workspace.",
    action: "Back to environments",
  },
  // Shown when the environment can't be loaded for a reason other than a clean
  // 404 (a server error, a network failure) — recoverable, so it offers a retry.
  loadError: {
    title: "Couldn’t load this environment",
    body: "Something went wrong fetching it. Retry, or go back to your environments.",
    retry: "Retry",
  },
  // The route-level error boundary fallback: a render error was caught instead of
  // blanking the page.
  crashed: {
    title: "This environment couldn’t be displayed",
    body: "Something went wrong rendering this page. Reload to try again, or go back to your environments.",
    reload: "Reload",
  },
  runBlocked: {
    agent: "Connect an agent on the Agents tab",
    scenarios: "Add scenarios on the Scenarios tab",
    evals: "Add at least one evaluation on the Evaluations tab",
    generic: "Setup incomplete",
  },
  // The env-version pin: lists every version of the world. Read only for now —
  // runs replay the default, and changing it is not offered.
  pin: {
    heading: "Environment versions",
    subtitle: "Runs replay the default version. Changing the default isn't available yet.",
    default: "default",
  },
  // Banner shown while the derivation is still in flight — the panels below are
  // loading and this explains why.
  building: {
    title: "Environment is still being built",
    progress: (done, total) => `${done} of ${total} steps done.`,
    deriving: "Scenarios and personas are still deriving.",
    tail: "You can leave and come back. This page will fill in as each stage lands.",
  },
  // Banner shown when an older env version is pinned — the amber pin is the
  // control, this is the reminder so edits do not silently sit on the wrong world.
  offLatest: {
    title: (label) => `Editing off ${label}`,
    body: (active, newest) =>
      `Latest is ${newest}. Runs from here will stamp against ${active}, and any edits sit on ${active}, not on the latest world.`,
    action: (label) => `Switch to ${label}`,
  },
  // The gap-count badge on a tab: a blocking setup gap the reader still owns.
  // The tooltip heads the list of gap titles routed to that tab.
  gaps: {
    tooltip: "Needs your input before you can run:",
  },
  // The pairing strip under the header: a run is this environment version
  // against that agent version, stated rather than selected.
  versionBar: {
    envPrefix: "env",
    agentPrefix: "agent",
    suitePrefix: "scenarios",
    testSubject: "Default",
    beforeVersioning: "before versioning",
    noAgent: "none",
    scenariosShared: (n) =>
      `${n} scenario${n === 1 ? "" : "s"}, shared across agent versions`,
    // Either label can be missing: an environment with agent versions but no
    // environment version yet, or one with no default agent version.
    pairingTooltip: (envLabel, envNote, agentLabel) =>
      [
        envLabel
          ? `Runs replay environment ${envLabel}${envNote ? ` (${envNote})` : ""}.`
          : "This environment has no environment version yet.",
        agentLabel
          ? `The environment's default agent version is ${agentLabel}; other agent versions can run against the same environment.`
          : "No default agent version is set for this environment.",
      ].join(" "),
    noVersionsTooltip:
      "This environment has no versions yet. One is recorded the next time it is built or saved.",
    scenariosTooltip:
      "Scenarios belong to the environment, so the same set runs against any agent version",
    defaultSuiteTooltip: (label) =>
      `The number of scenarios in the default scenario version, ${label}. The same set runs against any agent version.`,
  },
};

// The Versions tab: the agent, environment and scenario versions of this
// environment, what changed in each, and which scenarios a suite version holds.
export const VERSIONS_COPY = {
  title: "Versions",
  subtitle:
    "Every change to the agent, the environment or its scenarios is kept as a version. Runs replay the default environment and scenario versions.",
  pieces: {
    agent: "Agent",
    environment: "Environment",
    suite: "Scenarios",
  },
  noneInPiece: "No versions yet",
  empty: {
    title: "This environment has no versions yet",
    body: "A version is recorded the next time the environment is built or saved.",
  },
  loadError: "Couldn't load the versions. Try again in a moment.",
  disabled: "Versioning is switched off for this environment.",
  default: "default",
  unlabelled: "Unnumbered version",
  status: { draft: "draft", discarded: "discarded" },
  origin: {
    authoring: "Built",
    extend: "Extended",
    chat: "Saved from chat",
    manual: "Edited",
    backfill: "Recorded from before versioning",
    nudge: "Rebuilt",
    creation: "Created",
    push: "Pushed",
    upload: "Uploaded",
    prompt: "Prompt changed",
    agent_payload: "Settings changed",
    credentials: "Credentials changed",
    provider_sync: "Synced from provider",
  },
  by: (name) => `by ${name}`,
  detail: {
    pick: "Pick a version to see what changed in it.",
    changes: (label) => `What changed in ${label}`,
    compareWith: "Compared with",
    previous: "Its previous version",
    first: "This is the first version, so there is nothing earlier to compare with.",
    noChange: "Nothing changed.",
    noRecord: "No change record for this version.",
    notComparable: "These two versions can't be compared.",
    loadError: "Couldn't load the changes.",
    scenarios: (label, n) => `${n} scenario${n === 1 ? "" : "s"} in ${label}`,
    membersError: "Couldn't load the scenarios in this version.",
  },
  diff: {
    tools: "Tools",
    rules: "Rules",
    useCases: "Use cases",
    fields: "Contract fields changed",
    modality: "Modality",
    subGoals: "Sub-goals",
    files: "World files",
    filesUnknown: "World files of the earlier version aren't known, so file changes aren't shown.",
    added: "Added",
    removed: "Removed",
    changed: "Changed",
    scenariosAdded: "Scenarios added",
    scenariosRemoved: "Scenarios removed",
    scenariosChanged: "Scenarios changed",
    source: "Source changed",
    prompt: "Prompt changed",
    variables: "Variables",
  },
  members: {
    key: "Key",
    name: "Name",
    useCase: "Use case",
  },
};

export const RUN_DIALOG_COPY = {
  title: "Run simulation",
  pieces: {
    agent: "Agent version",
    environment: "Environment version",
    suite: "Scenario version",
  },
  default: "default",
  none: "None yet",
  unlabelled: "Unnumbered version",
  agentHelper: "Runs use the environment's current agent version.",
  loading: "Loading versions…",
  loadError: "Couldn't load the versions. The run uses the current defaults.",
  disabled: "Versioning is switched off, so the run uses the current versions.",
  checking: "Checking these versions…",
  planError: "Couldn't check these versions for warnings.",
  refused: "These versions can't run.",
  rerunFallback:
    "That run's versions can't run now; using the current defaults.",
  allScenarios: (n, suite) =>
    `Runs all ${n} scenario${n === 1 ? "" : "s"} in ${suite}.`,
  allCurrentScenarios: (suite) => `Runs all scenarios in ${suite}.`,
  emptySuite: (suite) => `${suite} has no scenarios to run.`,
  noneInSuite: (suite) => `None of the selected scenarios are in ${suite}.`,
  selectedScenarios: (n) => `Runs ${n} selected scenario${n === 1 ? "" : "s"}.`,
  membersLoading: "Loading the scenarios in this version…",
  membersError: "Couldn't load the scenarios in this version.",
  notInSuite: (keys, suite) =>
    `${keys.length} selected scenario${keys.length === 1 ? " isn't" : "s aren't"} in ${suite} and will be skipped: ${keys.join(", ")}`,
  trials: (n) => `${n} repeat${n === 1 ? "" : "s"} each.`,
  cancel: "Cancel",
  run: "Run",
  runAnyway: "Run anyway",
  starting: "Starting…",
};

// The run's agent is not the one its environment version was built with.
const shortVersion = (prefix, label) => {
  const number = /^v(\d+)$/i.exec(label || "")?.[1];
  if (number) return `${prefix}${number}`;
  return label ? `${prefix} ${label}` : null;
};
export const agentDiffersTag = (agentLabel, envLabel) => {
  const agent = shortVersion("A", agentLabel);
  const env = shortVersion("E", envLabel);
  return agent && env
    ? `${agent} differs from ${env}`
    : "Agent differs from its environment version";
};
