import { FRAMEWORK_META } from "../../_mock/agentRegistry";

/*
  The ways into New agent. Three carry the whole improve loop — we can read
  the agent, prove a change and ship it back (a new assistant version, a PR,
  a new prompt version). A framework agent can too, through our SDK adapter,
  but it's a narrower door — one row of frameworks, not a fourth card. An
  endpoint is a black box and an upload a one-off snapshot: both still
  connect, but neither can take a change back, so they sit last.
*/
export const CONNECT_KINDS = [
  {
    id: "hosted",
    title: "Hosted platform",
    icon: "solar:cloud-linear",
    blurb: "An assistant on a managed voice or chat platform. Add the API key, pick the agent from your account and its config comes in as v1.",
    preview: ["Vapi", "Retell", "Bland", "ElevenLabs", "LiveKit"],
  },
  {
    id: "repo",
    title: "Repository",
    icon: "solar:code-linear",
    blurb: "Code in a git repository. Pick the branch and folder — we read the entry point, prompts, tools and model, and you confirm what we found.",
    /* GitHub today; GitLab and Bitbucket are Coming soon. */
    preview: ["GitHub", "GitLab · Coming soon", "Bitbucket · Coming soon"],
  },
  {
    id: "builtin",
    title: "Built in Future AGI",
    icon: "solar:widget-add-linear",
    blurb: "No agent yet, or only a prompt? Write the instructions, pick a model and add tools here. It runs in Future AGI — nothing to deploy.",
    preview: ["System prompt", "Tools", "Model"],
  },
];

/* Each opens the adapter flow with that framework picked. */
export const FRAMEWORK_WAYS = Object.entries(FRAMEWORK_META).map(([id, f]) => ({ id, title: f.label, icon: f.icon }));

/* Ids match the environment builder's panels, which these reuse as is. */
export const MORE_WAYS = [
  { id: "running", title: "Agent endpoint", icon: "solar:global-linear", hint: "We call it over HTTP or WebSocket — we see what it does, not how" },
  { id: "upload", title: "Code upload", icon: "solar:cloud-upload-linear", hint: "Read once from a folder or zip" },
  { id: "phone", title: "Phone number", icon: "solar:phone-linear", hint: "Test only — ends in a suggested fix" },
];
