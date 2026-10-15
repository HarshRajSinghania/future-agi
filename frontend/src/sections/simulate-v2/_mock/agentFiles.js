/**
 * An agent version as files.
 *
 * Code agents already are a folder — config, prompt files, tool code,
 * knowledge docs. Hosted assistants keep the same things as fields in a
 * dashboard; rendered as files here, every agent reads the same way no matter
 * where it lives, and two versions can be compared file by file.
 *
 * Each file: { path, group, lang, content, doc?, observed? }
 *   group — Config | Prompts | Tools | Knowledge | Code
 *   doc   — a binary document; shown as a card, not as text
 */
import { FRAMEWORK_META, agentDefinitionOf, definitionOf, runtimeOf, sourceKindOf } from "./agentRegistry";

const yaml = (obj, indent = 0) => Object.entries(obj)
  .filter(([, v]) => v != null && v !== "")
  .map(([k, v]) => {
    const pad = " ".repeat(indent);
    if (Array.isArray(v)) return `${pad}${k}:\n${v.map((x) => `${pad}  - ${x}`).join("\n")}`;
    if (typeof v === "object") return `${pad}${k}:\n${yaml(v, indent + 2)}`;
    return `${pad}${k}: ${v}`;
  })
  .join("\n");

const toolSchema = (t) => JSON.stringify({
  name: t.name,
  description: t.desc,
  parameters: {
    type: "object",
    properties: Object.fromEntries((t.args || []).map((a) => [a, { type: "string" }])),
    required: t.args || [],
  },
}, null, 2);

const pyTool = (t) => [
  "@tool",
  `def ${t.name}(${(t.args || []).map((a) => `${a}: str`).join(", ")}) -> dict:`,
  `    """${t.desc || t.name}"""`,
  `    return api.post("/${t.name.replace(/_/g, "-")}", json={${(t.args || []).map((a) => `"${a}": ${a}`).join(", ")}})`,
].join("\n");

/* A framework tool is a decorated function in tools/, the way each
   framework registers one. */
const FRAMEWORK_TOOL = {
  langgraph: { import: "from langchain_core.tools import tool", deco: "@tool" },
  "openai-agents": { import: "from agents import function_tool", deco: "@function_tool" },
  crewai: { import: "from crewai.tools import tool", deco: (t) => `@tool("${t.name}")` },
};
const frameworkTool = (fw, t) => {
  const f = FRAMEWORK_TOOL[fw] || FRAMEWORK_TOOL.langgraph;
  return [
    f.import,
    "from support.api import api",
    "",
    "",
    typeof f.deco === "function" ? f.deco(t) : f.deco,
    `def ${t.name}(${(t.args || []).map((a) => `${a}: str`).join(", ")}) -> dict:`,
    `    """${t.desc || t.name.replace(/_/g, " ")}"""`,
    `    return api.post("/${t.name.replace(/_/g, "-")}", json={${(t.args || []).map((a) => `"${a}": ${a}`).join(", ")}})`,
  ].join("\n");
};

const shortPrompt = (name, tools) => [
  `You are the ${name.replace(/_/g, " ")} step of the support flow.`,
  "",
  ...(tools?.length ? ["Use only these tools:", ...tools.map((t) => `- ${t}`), ""] : []),
  "- Keep it short and say what you did.",
].join("\n");

/*
  A framework agent as the files its adapter described: the adapter's
  manifest, the wrapper, the framework's own module (graph, agents or
  crew), a prompt per node or agent, and the tools. The first prompt file
  carries the version's instructions, so a synced change shows as a diff.
*/
const frameworkFiles = ({ agent, def, d, rt, tools }) => {
  const fw = d.framework || "langgraph";
  const label = FRAMEWORK_META[fw]?.label || "SDK";
  const [modulePath, symbol] = String(d.entry || "support/graph.py:graph").split(":");
  const mod = modulePath.replace(/\.py$/, "").replace(/\//g, ".");
  const toolNames = tools.map((t) => t.name);
  const out = [];

  out.push({
    path: "futureagi.yaml", group: "Config", lang: "yaml",
    content: yaml({
      name: agent?.name,
      adapter: `futureagi.adapters.${fw.replace("-", "_")}`,
      framework: label,
      entry: d.entry,
      model: { name: def.model.name, temperature: def.model.temperature },
      serve: rt.where || "not running",
      ...(d.repoUrl && { source: { repo: d.repoUrl, ref: d.ref || "main" } }),
      tools: toolNames,
    }),
  });

  if (fw === "openai-agents") {
    const agents = d.agents || [];
    out.push({
      path: "serve.py", group: "Code", lang: "python",
      content: ["from agents import Runner", "from futureagi.adapters import openai_agents as fagi", `from ${mod} import ${symbol}`, "", `app = fagi.serve(${symbol}, runner=Runner)`].join("\n"),
    });
    agents.forEach((a, i) => out.push({
      path: a.instructions || `prompts/${a.name}.md`, group: "Prompts", lang: "markdown",
      content: i === 0 ? def.instructions.text : shortPrompt(a.name, a.tools),
    }));
    out.push({
      path: modulePath, group: "Code", lang: "python",
      content: [
        "from agents import Agent",
        "from support.prompts import load",
        `from tools import ${toolNames.join(", ") || "*"}`,
        ...(d.guardrails?.length ? ["from support.guardrails import " + d.guardrails.map((g) => g.split(" · ").pop()).join(", ")] : []),
        "",
        ...[...agents].reverse().flatMap((a) => [
          `${a.name} = Agent(`,
          `    name="${a.name}",`,
          `    model="${def.model.name}",`,
          `    instructions=load("${a.instructions}"),`,
          ...(a.tools?.length ? [`    tools=[${a.tools.join(", ")}],`] : []),
          ...(a.handoffs?.length ? [`    handoffs=[${a.handoffs.join(", ")}],`] : []),
          ...(a === agents[0] && d.guardrails?.length ? [
            `    input_guardrails=[${d.guardrails.filter((g) => g.startsWith("input")).map((g) => g.split(" · ").pop()).join(", ")}],`,
            `    output_guardrails=[${d.guardrails.filter((g) => g.startsWith("output")).map((g) => g.split(" · ").pop()).join(", ")}],`,
          ] : []),
          ")",
          "",
        ]),
      ].join("\n").trim(),
    });
    if (d.guardrails?.length) {
      out.push({
        path: "support/guardrails.py", group: "Code", lang: "python",
        content: ["from agents import input_guardrail, output_guardrail, GuardrailFunctionOutput", "", ...d.guardrails.flatMap((g) => {
          const [side, name] = g.split(" · ");
          return [`@${side === "output" ? "output" : "input"}_guardrail`, `async def ${name}(ctx, agent, data):`, `    return GuardrailFunctionOutput(output_info=None, tripwire_triggered=False)`, ""];
        })].join("\n").trim(),
      });
    }
  } else if (fw === "crewai") {
    const c = d.crew || { name: "Crew", process: "sequential", agents: [], tasks: [] };
    const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
    out.push({
      path: "serve.py", group: "Code", lang: "python",
      content: ["from futureagi.adapters import crewai as fagi", `from ${mod} import ${symbol}`, "", `app = fagi.serve(${symbol}().crew())`].join("\n"),
    });
    out.push({
      path: "config/agents.yaml", group: "Prompts", lang: "yaml",
      content: c.agents.map((a, i) => [
        `${slug(a.role)}:`,
        `  role: ${a.role}`,
        `  goal: ${a.goal}`,
        "  backstory: >",
        ...(i === 0 ? def.instructions.text.split("\n").map((l) => `    ${l}`) : [`    You work on the ${c.name} support desk.`]),
      ].join("\n")).join("\n\n"),
    });
    out.push({
      path: "config/tasks.yaml", group: "Prompts", lang: "yaml",
      content: c.tasks.map((t) => [`${t.name}:`, `  description: ${t.name.replace(/_/g, " ")} for the customer's request`, `  agent: ${slug(t.agent)}`].join("\n")).join("\n\n"),
    });
    out.push({
      path: modulePath, group: "Code", lang: "python",
      content: [
        "from crewai import Agent, Crew, Process, Task",
        "from crewai.project import CrewBase, agent, crew, task",
        `from tools import ${toolNames.join(", ") || "*"}`,
        "",
        "",
        "@CrewBase",
        `class ${symbol}:`,
        ...c.agents.flatMap((a) => ["    @agent", `    def ${slug(a.role)}(self) -> Agent:`, `        return Agent(config=self.agents_config["${slug(a.role)}"], llm="${def.model.name}"${a.tools?.length ? `, tools=[${a.tools.join(", ")}]` : ""})`, ""]),
        ...c.tasks.flatMap((t) => ["    @task", `    def ${t.name}(self) -> Task:`, `        return Task(config=self.tasks_config["${t.name}"])`, ""]),
        "    @crew",
        "    def crew(self) -> Crew:",
        `        return Crew(agents=self.agents, tasks=self.tasks, process=Process.${c.process})`,
      ].join("\n"),
    });
  } else {
    const g = d.graph || { nodes: [], flow: "" };
    out.push({
      path: "serve.py", group: "Code", lang: "python",
      content: ["from futureagi.adapters import langgraph as fagi", `from ${mod} import ${symbol}`, "", `app = fagi.serve(${symbol})`].join("\n"),
    });
    /* The first node that acts (has tools) holds the version's instructions. */
    const main = g.nodes.find((n) => n.prompt && n.tools?.length) || g.nodes.find((n) => n.prompt);
    g.nodes.filter((n) => n.prompt).forEach((n) => out.push({
      path: n.prompt, group: "Prompts", lang: "markdown",
      content: n === main ? def.instructions.text : shortPrompt(n.id, n.tools),
    }));
    out.push({
      path: modulePath, group: "Code", lang: "python",
      content: [
        "from langgraph.graph import StateGraph, START, END",
        "from langgraph.prebuilt import create_react_agent",
        "from support.prompts import load",
        `from tools import ${toolNames.join(", ") || "*"}`,
        "from support.state import SupportState, route",
        "",
        `MODEL = "${def.model.name}"`,
        "",
        "builder = StateGraph(SupportState)",
        ...g.nodes.map((n) => (n.tools?.length
          ? `builder.add_node("${n.id}", create_react_agent(MODEL, [${n.tools.join(", ")}], prompt=load("${n.prompt}")))`
          : `builder.add_node("${n.id}", ${n.id})`)),
        "",
        `builder.add_edge(START, "${g.nodes[0]?.id || "router"}")`,
        ...(g.nodes.length >= 4 ? [
          `builder.add_conditional_edges("${g.nodes[0].id}", route, ["${g.nodes[1].id}", "${g.nodes[2].id}"])`,
          `builder.add_edge("${g.nodes[1].id}", "${g.nodes[3].id}")`,
          `builder.add_edge("${g.nodes[2].id}", "${g.nodes[3].id}")`,
          `builder.add_edge("${g.nodes[3].id}", END)`,
        ] : []),
        "",
        `${symbol} = builder.compile()`,
      ].join("\n"),
    });
  }

  tools.forEach((t) => out.push({ path: `tools/${t.name}.py`, group: "Tools", lang: "python", content: frameworkTool(fw, t) }));
  out.push({ path: ".env.example", group: "Config", lang: "bash", content: "FUTUREAGI_API_KEY=\nOPENAI_API_KEY=\nORDERS_API_URL=https://api.example.com" });
  return out;
};

/** Every file in one version of the agent. */
const vnum = (label) => parseInt(String(label || "").replace(/\D/g, ""), 10) || 1;
const bundleAt = (agent, version) => [...(agent?.versions || [])]
  .filter((x) => !version || vnum(x.label) <= vnum(version.label))
  .reverse().find((x) => x.bundle)?.bundle;

export const agentFilesOf = ({ agent, version, env, envState }) => {
  const def = agentDefinitionOf({ agent, version, env, envState });
  const kind = sourceKindOf(agent);
  const v = agent?.values || {};
  const d = definitionOf(agent);
  const rt = runtimeOf(agent);
  const tools = def.tools.items;
  const files = [];

  if (kind === "platform") {
    files.push({
      path: "agent.yaml", group: "Config", lang: "yaml",
      content: yaml({
        name: agent?.name || v.agentId,
        provider: v.provider,
        assistant_id: v.agentId,
        model: { name: def.model.name, temperature: def.model.temperature, max_tokens: def.model.maxTokens },
        ...(def.voice?.visible && {
          voice: { transcriber: def.voice.stt, synthesizer: def.voice.tts, voice: def.voice.voice, interruptions: def.voice.interruptions },
        }),
        ...(v.callDirection && { call: { direction: v.callDirection, max_duration: "10m", end_call_phrases: ["goodbye", "that's all"] } }),
        tools: tools.map((t) => t.name),
      }),
    });
    files.push({ path: "prompts/system.md", group: "Prompts", lang: "markdown", content: def.instructions.text });
    if (def.voice) {
      files.push({
        path: "prompts/first_message.md", group: "Prompts", lang: "markdown",
        content: `Thanks for calling ${env?.name || "support"}. Can I start with your order number?`,
      });
    }
  }

  if (kind === "prompt") {
    files.push({ path: "prompts/system.md", group: "Prompts", lang: "markdown", content: def.instructions.text || "(empty)" });
    files.push({
      path: "connection.yaml", group: "Config", lang: "yaml",
      content: yaml({ runtime: rt.label, reached_at: rt.where, calls: v.contact?.mode, agent_speaks_first: v.contact?.agentSpeaksFirst != null ? String(v.contact.agentSpeaksFirst) : undefined }),
    });
  }

  /* Built here: the definition is the whole agent — no code behind it. */
  if (kind === "builtin") {
    files.push({
      path: "agent.yaml", group: "Config", lang: "yaml",
      content: yaml({
        name: agent?.name,
        runs_in: "Future AGI",
        model: { name: def.model.name, temperature: def.model.temperature },
        prompt: "prompts/system.md",
        tools: tools.map((t) => t.name),
      }),
    });
    files.push({ path: "prompts/system.md", group: "Prompts", lang: "markdown", content: def.instructions.text || "(empty)" });
  }

  if (kind === "repo" || kind === "upload") {
    files.push({
      path: "agent.yaml", group: "Config", lang: "yaml",
      content: yaml({
        entrypoint: "src/agent.py:agent",
        model: { name: def.model.name, temperature: def.model.temperature },
        prompt: "prompts/system.md",
        tools: "src/tools.py",
        ...(kind === "repo" && { source: { repo: d.repoUrl || "not recorded", ref: d.ref || "main" } }),
        /* The bundle this version was uploaded as — a new one comes with Add version. */
        ...(kind === "upload" && { source: { bundle: bundleAt(agent, version) || d.bundle } }),
        runtime: rt.kind === "none" ? "not recorded" : { [rt.kind === "platform" ? "platform" : "endpoint"]: rt.where },
      }),
    });
    files.push({ path: "prompts/system.md", group: "Prompts", lang: "markdown", content: def.instructions.text });
    files.push({
      path: "src/agent.py", group: "Code", lang: "python",
      content: [
        "from fagi_agents import Agent, load_prompt",
        "from .tools import " + (tools.map((t) => t.name).join(", ") || "*"),
        "",
        "agent = Agent(",
        `    model="${def.model.name}",`,
        `    temperature=${def.model.temperature},`,
        '    instructions=load_prompt("prompts/system.md"),',
        `    tools=[${tools.map((t) => t.name).join(", ")}],`,
        ")",
      ].join("\n"),
    });
    files.push({
      path: "src/tools.py", group: "Code", lang: "python",
      content: ["from fagi_agents import tool, api", "", ...tools.map(pyTool).flatMap((b) => [b, ""])].join("\n").trim(),
    });
    files.push({ path: ".env.example", group: "Config", lang: "bash", content: "OPENAI_API_KEY=\nORDERS_API_URL=https://api.example.com\nORDERS_API_TOKEN=" });
  }

  if (kind === "framework") files.push(...frameworkFiles({ agent, def, d, rt, tools }));

  if (kind === "mcp") {
    files.push({
      path: "mcp.json", group: "Config", lang: "json",
      content: JSON.stringify({ mcpServers: { agent: { url: v.mcpUrl, transport: v.transport || "sse" } } }, null, 2),
    });
    files.push({ path: "instructions.md", group: "Prompts", lang: "markdown", content: def.instructions.text });
  }

  if (kind === "endpoint") {
    files.push({
      path: "connection.yaml", group: "Config", lang: "yaml",
      content: yaml({ endpoint: v.endpoint || v.sdkEndpoint, auth: v.auth || "none", reply_path: v.messagePath, session_path: v.sessionPath, streaming: v.streaming ? "true" : undefined }),
    });
  }

  /* A framework agent's tools are its own Python files, above. */
  if (kind !== "framework") {
    tools.forEach((t) => files.push({
      path: `tools/${t.name}.json`, group: "Tools", lang: "json", content: toolSchema(t), observed: def.tools.observed,
    }));
  }

  if (def.knowledge.visible) {
    def.knowledge.items.forEach((k) => files.push({
      path: `knowledge/${k.name}`, group: "Knowledge", lang: "doc", doc: true, content: k.meta,
    }));
  }

  return { files, definition: def };
};

/** Which files differ between two versions: added, changed, removed. */
export const fileChanges = (before, after) => {
  const prev = new Map((before || []).map((f) => [f.path, f]));
  const next = new Map((after || []).map((f) => [f.path, f]));
  const out = {};
  next.forEach((f, p) => {
    if (!prev.has(p)) out[p] = "added";
    else if (prev.get(p).content !== f.content) out[p] = "changed";
  });
  prev.forEach((f, p) => { if (!next.has(p)) out[p] = "removed"; });
  return out;
};

/** Line diff (LCS). Files here are short, so the quadratic table is fine. */
export const diffLines = (a, b) => {
  const x = a == null ? [] : String(a).split("\n");
  const y = b == null ? [] : String(b).split("\n");
  const m = x.length;
  const n = y.length;
  const t = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (x[i] === y[j]) { out.push({ type: "same", text: x[i] }); i += 1; j += 1; } else if (t[i + 1][j] >= t[i][j + 1]) { out.push({ type: "del", text: x[i] }); i += 1; } else { out.push({ type: "add", text: y[j] }); j += 1; }
  }
  while (i < m) { out.push({ type: "del", text: x[i] }); i += 1; }
  while (j < n) { out.push({ type: "add", text: y[j] }); j += 1; }
  return out;
};
