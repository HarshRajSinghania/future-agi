/**
 * The prompt an agent version runs with — the thing the environment was read
 * from, so a reviewer can check the build against it.
 *
 * A prompt pasted on the connect form is kept word for word. A repo, endpoint
 * or hosted assistant carries its prompt inside the source; the prototype has
 * no real source to open, so it composes the prompt that source would hold
 * from what the build read out of it (its tools and rules) and says where it
 * was read from.
 */

const ORIGIN_BY_KIND = {
  repo: "prompts/system.md",
  upload: "prompts/system.md",
  endpoint: "the endpoint's /config",
  mcp: "the MCP server's instructions",
  platform: "the assistant's system prompt",
};

const chatOf = (env) => env?.surface === "chat" || /chat/.test(env?.agentType || "") || env?.channel === "chat";

const composed = (env) => {
  const tools = (env?.tools || []).map((t) => `- ${t.name}${t.args?.length ? `(${t.args.join(", ")})` : "()"} — ${t.desc || ""}`.trim());
  const rules = (env?.rules || []).map((r) => `- ${r}`);
  return [
    /* Named for what it serves, not the environment testing it. */
    `You are the ${chatOf(env) ? "chat" : "voice"} agent for ${env?.name ? `the ${env.name.replace(/\s+environment$/i, "").toLowerCase()}` : "customer support"}.`,
    env?.description || "",
    "",
    "## Tools",
    ...(tools.length ? tools : ["- (none)"]),
    "",
    "## Rules",
    ...(rules.length ? rules : ["- (none)"]),
    "",
    "## Style",
    "- Keep turns short; confirm before any action that changes an account.",
    "- If a request falls outside these rules, say so and offer a hand-over.",
  ].filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n");
};

/** { text, origin, submitted } for a build's source. */
export const agentPromptOf = (source, env) => {
  const pasted = (source?.prompt || source?.systemPrompt || "").trim();
  if (pasted) return { text: pasted, origin: "Pasted when you connected the agent", submitted: true };
  const kind = source?.kind || "repo";
  const where = (source?.value || "").trim();
  const from = ORIGIN_BY_KIND[kind] || ORIGIN_BY_KIND.repo;
  return {
    text: composed(env),
    origin: `Read from ${from}${where && kind !== "platform" ? ` · ${where}` : ""}`,
    submitted: false,
  };
};
