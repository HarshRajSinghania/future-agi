/**
 * The replay flag.
 *
 * Every call a simulation makes to the customer's agent says it is a
 * simulation — an HTTP header, and the same fact in the SDK's run context —
 * so the agent can hold back the tools that reach a real system. A refund
 * issued during a test is a real refund unless the agent is told not to.
 *
 * Which tools count is the customer's call, stored on the environment as
 * `replay: { stubbed: [toolName] }`. Until they make it, tools whose name
 * says they change something are marked.
 */

export const REPLAY_HEADER = "x-fagi-replay: 1";
export const REPLAY_SDK = "replay=true";

const SIDE_EFFECT = /refund|cancel|book|charge|transfer|send|update|delete|create/i;

/** Is this tool marked by default? */
export const looksSideEffecting = (name) => SIDE_EFFECT.test(name || "");

/** Names of the environment's tools the agent should stub under the flag. */
export const stubbedToolNames = (env, envState) => {
  const tools = env?.tools || [];
  const stored = envState?.replay?.stubbed;
  /* A stored list is a decision someone made — it wins, minus tools the
     environment no longer has. */
  if (Array.isArray(stored)) return tools.map((t) => t.name).filter((n) => stored.includes(n));
  return tools.map((t) => t.name).filter(looksSideEffecting);
};

/** Patch fragment that marks or unmarks one tool. */
export const toggleStubPatch = (env, envState, name, on) => {
  const current = stubbedToolNames(env, envState);
  const stubbed = on ? [...new Set([...current, name])] : current.filter((n) => n !== name);
  return { replay: { ...(envState?.replay || {}), stubbed } };
};
