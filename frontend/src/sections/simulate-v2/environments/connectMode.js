import { createContext } from "react";

/*
  The environment's "connect your own agent" panels, reused on the Agents
  page. When this context is provided, a panel's submit connects the agent
  ({ onConnect }) instead of building an environment from it.
*/
export const ConnectModeContext = createContext(null);

/*
  Where the agent runs, for panels that read it from code (a repository or
  an upload), while building an environment. The Agents page asks for it
  through ConnectModeContext, the same way.
*/
export const RuntimeContext = createContext(null);

/*
  The optional agent name — asked for in both modes, so an agent connected
  while building an environment isn't left showing its assistant ID.
*/
export const AgentNameContext = createContext(null);

/*
  What the landing screen already knows when it opens a setup panel — a
  pasted repository, an assistant ID, an MCP URL, a picked platform or an
  agent already connected. Panels read it once, for their starting values.
*/
export const PrefillContext = createContext(null);

/*
  True when a connect flow shows inside a drawer whose header already names
  it — the flow then drops its own title and description.
*/
export const InDrawerContext = createContext(false);
