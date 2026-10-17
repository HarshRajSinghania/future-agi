import { BUILD_TONES } from "../../buildEnvironment/buildTones";

// Accent hues for the Agents cards. Purple marks the environment source; green
// marks the version/agent that runs execute against. Both are references into
// BUILD_TONES so a single hue is shared across every card in this folder.
export const SOURCE_ACCENT = BUILD_TONES.accent;
export const ACTIVE_ACCENT = BUILD_TONES.green;

// Copy strings for the Agents cards, kept out of the JSX so they can be
// translated / reviewed in one place.
export const AGENT_CARD_COPY = {
  addVersion: "Add new version",
  newVersion: "New version",
  setActive: "Set active",
  setActiveForRuns: "Set active",
  rollBack: "Roll back to this",
  promoteToSource: "Promote to source",
  active: "ACTIVE",
  activeForRuns: "ACTIVE FOR RUNS",
  envSource: "ENV SOURCE",
  previouslySource: "· previously the source",
  versions: "Versions",
  versionHistory: "Version history",
  connection: "Connection",
  source: "Source",
  noVersions: "No versions recorded.",
  environmentCredentials: "Environment credentials",
  issuedCredentials: "Issued for this environment",
  credentialsSubtitle: "Rotates whenever you reset the environment",
  testPhoneLabel: "Test phone number",
  envTokenLabel: "Environment token",
  removeSource: "Remove source. The environment will need a new one before it can run",
  removeAdditional: "Remove from this environment",
  additionalTested: "Tested against the source's scenarios, tools and rules.",
  expand: "Expand details",
  collapse: "Collapse details",
  copy: "Copy",
};

// Mock environment credentials the cards display. Named as mock so the live
// credential-issuing pipeline can find and replace them in one pass.
export const MOCK_CREDENTIALS = {
  testPhoneNumber: "+1 (415) 555-0182",
  environmentToken: "fagi_sim_sk_9c2f4b7ae15d8306",
};
