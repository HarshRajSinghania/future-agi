/**
 * Observability — watching a connected agent's real (production) calls.
 *
 * Simulation says how an agent *might* behave; production says how it
 * *does*. Watching production is what makes the rest of the loop work:
 *   · the agent page can put production next to simulation, call for call
 *     and eval for eval — the gap between them is the most useful number
 *   · Error Feed clusters real failures for this agent
 *   · Add scenarios → From production turns those failures into tests
 * Without it, failures are only ever found by guessing what to simulate.
 *
 * How it's turned on depends on how the agent is connected:
 *   platform — Vapi, Retell…: we pull calls through the provider API with the
 *              key given when connecting. One switch.
 *   traceai  — a repository we can open a PR on: one PR adds traceAI.
 *   sdk      — anything else reached at an endpoint: a short traceAI snippet
 *              the team adds themselves, then confirms here.
 * Calls land in an Observe project named after the agent.
 */
import { agentSourceOf } from "./agentRegistry";
import { getEval } from "./evals";

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
/* A small seeded generator, so a reload shows the same calls. */
const rng = (seed) => {
  let x = seed || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
};
const slug = (s) => String(s || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** The Observe project an agent's calls land in. */
export const observeProjectFor = (agent) => slug(agent?.baseName || agent?.name);

/**
 * Whether this agent's production calls are watched, and how it's turned on.
 * { mode: platform|traceai|sdk, on, since, project, needsKey }
 */
export const observabilityOf = (agent, integrations) => {
  const source = agentSourceOf(agent);
  const v = agent?.values || {};
  /* A pull request needs the repository in the GitHub app; any other
     repository is set up like an endpoint — the team adds the snippet. */
  if (source.kind === "repo" && source.viaApp) {
    const t = integrations?.tracing?.[agent.key];
    return { mode: "traceai", on: !!t?.on, since: t?.since || null, project: t?.project || observeProjectFor(agent) };
  }
  const o = v.observability || {};
  /* Watching can't have started before the agent was connected. */
  const since = o.since && agent?.connectedAt && Date.parse(o.since) < Date.parse(agent.connectedAt) ? agent.connectedAt : o.since;
  const platform = source.kind === "platform" && v.provider !== "other";
  return {
    mode: platform ? "platform" : "sdk",
    on: !!o.on,
    since: since || null,
    project: o.project || observeProjectFor(agent),
    /* Pulling calls from a provider needs its API key. */
    needsKey: platform && !(v.hasApiKey || v.apiKeyRef),
    /* Asked for when connecting, not set up yet (endpoint agents). */
    requested: !!o.requested,
  };
};

/** The values patch that turns watching on or off for a non-repo agent. */
export const observabilityPatch = (agent, on, now = new Date().toISOString()) => ({
  observability: on ? { on: true, since: now, project: observeProjectFor(agent) } : { on: false },
});

/* The evals an agent is graded on: whatever its environments apply, or the
   two every surface supports. */
export const agentEvalIds = (agent, state) => {
  const ids = new Set();
  (agent?.usedIn || []).forEach((u) => (state?.byEnv?.[u.envId]?.evals || []).forEach((e) => ids.add(typeof e === "string" ? e : e.id)));
  return ids.size ? [...ids] : ["task_success", "policy_adherence"];
};

/* What the caller rang about, from the tool the call needed — said the way
   a caller would: lookup_order → "Check order", send_otp → "Get an OTP". */
const TOPIC_VERB = { lookup: "Check", get: "Check", check: "Check", list: "Check", issue: "Get", send: "Get", create: "Set up", update: "Change", cancel: "Cancel", escalate: "Speak to", apply: "Apply", generate: "Get", verify: "Verify" };
const ARTICLE = new Set(["issue", "send", "create", "generate"]);
const topicOf = (tool) => {
  if (!tool) return "General question";
  const [verb, ...rest] = String(tool).split("_");
  let noun = rest.join(" ").replace(/^to /, "").replace(/\b(otp|sms|id)\b/g, (m) => m.toUpperCase());
  if (ARTICLE.has(verb)) noun = `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
  const v = TOPIC_VERB[verb];
  return v ? `${v} ${noun}` : tool.replace(/_/g, " ");
};
/* The same, as the caller says it on the line: "check on my order". */
const MINE = /^(order|booking|card|account|refund|return|address|subscription|payment|delivery|shipment|reservation|plan|bill|claim)/i;
const askOf = (tool, topic) => {
  if (!tool) return "ask about something";
  const [verb] = String(tool).split("_");
  const rest = topic.replace(/^\S+\s/, "").replace(/^(up|to)\s/, "");
  const lower = rest.replace(/\b(?!OTP|SMS|ID)\w+/g, (w) => w.toLowerCase());
  if (["lookup", "get", "check", "list"].includes(verb)) {
    return `check on ${MINE.test(rest) ? "my" : "the"} ${lower}`;
  }
  if (verb === "escalate") return "speak to a person";
  if (verb === "verify") return `verify my ${lower}`;
  if (verb === "apply") return `get some ${lower}`;
  return topic.charAt(0).toLowerCase() + topic.slice(1);
};

const ENDINGS = [
  { reason: "Caller hung up", status: "completed", w: 0.52 },
  { reason: "Agent ended the call", status: "completed", w: 0.28 },
  { reason: "Transferred to a human", status: "transferred", w: 0.12 },
  { reason: "Silence timeout", status: "dropped", w: 0.05 },
  { reason: "Call dropped", status: "dropped", w: 0.03 },
];
const pickEnding = (r) => {
  let acc = 0;
  const x = r();
  return ENDINGS.find((e) => { acc += e.w; return x <= acc; }) || ENDINGS[0];
};

/* Which version was live when a call happened — the newest one created
   before it. A pending draft was never live, so it never takes calls. */
const versionAt = (versions, at) => {
  const t = Date.parse(at);
  const live = [...(versions || [])].filter((v) => !v.pendingDraft && Date.parse(v.createdAt || v.connectedAt || 0) <= t);
  return (live[live.length - 1] || versions?.[0])?.label || "v1";
};

/**
 * This agent's recent production calls — a deterministic sample of the last
 * week, each tagged with the version that was live and scored on the same
 * evals as its simulations. `weekTotal` is the full count the sample stands
 * for.
 */
export const productionCallsFor = (agent, { evalIds = ["task_success", "policy_adherence"], tools = [], since, now = Date.now() } = {}) => {
  const seed = hash(agent?.key || agent?.name || "agent");
  const r = rng(seed);
  const start = Math.max(since ? Date.parse(since) : now - 7 * 864e5, now - 7 * 864e5);
  const span = now - start;
  /* Dense enough that the newest version — often only a day or two live —
     has a sample worth comparing. */
  const n = span > 0 ? Math.max(8, Math.min(96, Math.round((span / 864e5) * 14))) : 0;
  /* Production is a little harder than the simulated world — callers say
     things nobody scripted — so its eval rates sit a touch lower, by an
     amount that's stable per agent and eval. */
  /* The one eval real callers push hardest on — something the scenarios
     don't do. Policy adherence when it's graded: real callers argue, push
     for exceptions and change their story more than a scripted persona. */
  const weak = evalIds.includes("policy_adherence") ? "policy_adherence" : evalIds[seed % Math.max(1, evalIds.length)];
  const base = Object.fromEntries(evalIds.map((id) => {
    /* Centred just above the eval's own bar, so most real calls pass and a
       stable few per agent don't — a strict eval isn't a failing one. The
       weak one sits just under it, so about half of real calls miss. */
    const bar = getEval(id)?.threshold ?? 0.8;
    if (id === weak) return [id, bar - 0.03];
    return [id, Math.min(0.99, bar + 0.02 + ((hash(`${seed}:${id}`) % 7) / 100))];
  }));
  const calls = Array.from({ length: n }).map((_, i) => {
    const at = new Date(now - (i + r() * 0.8) * (span / n)).toISOString();
    const ending = pickEnding(r);
    const turns = 6 + Math.floor(r() * 16);
    const durationS = Math.round(turns * (7 + r() * 9));
    const tool = tools.length ? tools[Math.floor(r() * tools.length)] : null;
    const evals = evalIds.map((id) => {
      const def = getEval(id);
      const score = Math.max(0, Math.min(1, base[id] + (r() - 0.35) * 0.16 - (ending.status === "dropped" ? 0.25 : 0)));
      return { id, name: def?.name || id, color: def?.color, score: Math.round(score * 100) / 100, passed: score >= (def?.threshold ?? 0.8) };
    });
    return {
      id: `prod-${(seed % 9973).toString(36)}-${i}`,
      at,
      version: versionAt(agent?.versions, at),
      topic: topicOf(tool),
      ask: askOf(tool, topicOf(tool)),
      tool,
      caller: `+1 ••• ${1000 + Math.floor(r() * 9000)}`,
      durationS,
      turns,
      latencyMs: Math.round(420 + r() * 900),
      tokens: Math.round(turns * (140 + r() * 160)),
      cost: Math.round(durationS * (0.0011 + r() * 0.0009) * 100) / 100,
      status: ending.status,
      endedReason: ending.reason,
      evals,
      passed: evals.every((e) => e.passed),
    };
  });
  return { calls, weekTotal: n ? 380 + (seed % 1400) : 0 };
};

/* A production call as the shared call drawer's task shape — the drawer
   already knows how to show a transcript, timings and eval results. The
   transcript is illustrative: a prototype has no real call to replay. */
export const productionCallTask = (call, agent) => {
  const r = rng(hash(call.id));
  const lines = [
    ["customer", `Hi — I'm calling to ${call.ask || call.topic.toLowerCase()}.`],
    ["agent", "Thanks for calling. I can help with that — can I take your name and the number on the account?"],
    ["customer", "Sure, it's under the number I'm calling from."],
    ["agent", call.tool ? `Got it. Let me pull that up for you now.` : "Got it. What can I do for you today?"],
    ["customer", "How long will this take?"],
    ["agent", "Just a moment — I have it here."],
    ["customer", call.status === "transferred" ? "I'd rather speak to someone, please." : "Okay, great."],
    ["agent", call.status === "transferred" ? "Of course — transferring you to a colleague now." : "You're all set. Is there anything else?"],
  ].slice(0, Math.max(4, Math.min(8, call.turns)));
  const per = (call.durationS * 1000) / lines.length;
  return {
    id: call.id,
    title: call.topic,
    summary: `Production call — the caller wanted to ${call.ask || call.topic.toLowerCase()}. ${call.endedReason}.`,
    persona: { name: call.caller },
    steps: lines.map(([role, text], i) => ({ id: `${call.id}-s${i}`, index: i, role, text, duration: Math.round(per * (0.7 + r() * 0.6)) })),
    durationMs: call.durationS * 1000,
    evalResults: call.evals.map((e) => ({ ...e, reason: e.passed ? "Met the bar on this call." : "Fell below the threshold on this call." })),
    agentName: agent?.name,
  };
};
