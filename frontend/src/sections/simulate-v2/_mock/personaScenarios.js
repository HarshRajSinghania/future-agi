/**
 * Personas from the workspace library, used in an environment.
 *
 * The library (Environments → Personas) holds reusable callers — Future AGI
 * built ones and the team's own. An environment doesn't hold personas on
 * their own: every scenario carries the persona it's written for. So using a
 * library persona in an environment means writing scenarios for it — the
 * environment's own tasks, met by that caller — stamped as coming from the
 * library so it's clear where the caller came from.
 *
 * The task comes from the environment; how it's asked comes from the persona.
 * Each scenario is written in the persona's voice — their opening line, how
 * they carry the call, and the tone/style the simulator plays them with — so
 * the same task reads differently for a rushed caller and a polite senior one.
 * (The product writes these with the builder's model; the prototype composes
 * them from the persona's own traits.)
 */
import { normalizePersona } from "src/sections/persona/personaApiShape";
import { getRows } from "./scenarios";
import { stampNewBatch } from "./addScenarios";

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const first = (v) => arr(v)[0] || null;
const slug = (s) => String(s || "persona").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const words = (s, n) => slug(String(s).replace(/^the\s+/i, "")).split("-").slice(0, n).join("-");

/* The persona's call behaviour, as configured in the library — voice
   personas carry pace, background sound and turn-taking; chat personas carry
   how they type. This is what makes a library persona worth keeping, so it
   travels with the scenario rather than being re-guessed from traits. */
const callSettingsOf = (raw) => {
  const p = normalizePersona(raw) || {};
  const languages = arr(p.languages ?? p.language).filter(Boolean);
  const num = (v) => { const n = parseFloat(first(v)); return Number.isNaN(n) ? null : n; };
  const out = {
    speed: num(p.conversationSpeed),
    backgroundSound: p.backgroundSound == null ? null : !!p.backgroundSound,
    interruptSensitivity: num(p.interruptSensitivity),
    finishedSpeakingSensitivity: num(p.finishedSpeakingSensitivity),
    languages,
    tone: p.tone || null,
    verbosity: p.verbosity || null,
    typos: p.typosFrequency || null,
    slang: p.slangUsage || null,
    emoji: p.emojiUsage || null,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length)));
};

/** The library persona as the persona a scenario carries. */
export const scenarioPersonaFrom = (p) => {
  const gender = first(p.gender);
  return {
    name: p.name,
    slug: `lib-${p.id}`,
    libraryId: p.id,
    libraryName: p.name,
    builtIn: !!(p.isDefault ?? p.is_default),
    description: p.description || "",
    ...(gender && { gender: String(gender).toLowerCase() }),
    ...(first(p.ageGroup ?? p.age_group) && { ageGroup: first(p.ageGroup ?? p.age_group) }),
    ...(first(p.profession ?? p.occupation) && { role: first(p.profession ?? p.occupation) }),
    voice: [first(p.accent), first(p.language)].filter(Boolean).join(" · ") || undefined,
    traits: [...arr(p.personality), ...arr(p.communicationStyle ?? p.communication_style)].filter(Boolean).slice(0, 4),
    callSettings: callSettingsOf(p),
  };
};

/* ── The environment's tasks ─────────────────────────────────────────── */

/* The environment's own tasks, stated plainly — one routine request per tool,
   then its edge cases. The derived pool also holds rule probes, traps and
   adversarial pushes, but those script the caller's manner (rushed, sympathy
   story, fake authority) — the library persona supplies the manner here, so
   only the tasks themselves are paired with it. Falls back to the scenarios
   the environment already has. */
const tasksOf = (env, envState) => {
  const pool = env ? [
    ...getRows(`${env.id}::core`, env).filter((r) => r.id.endsWith("-routine")).map((r) => ({ ...r, title: r.useCase || r.title, summary: null, kind: "task" })),
    ...getRows(`${env.id}::edge`, env).map((r) => ({ ...r, kind: "edge" })),
  ] : [];
  if (pool.length) return pool;
  return (envState?.scenarios || []).length ? envState.scenarios : [{
    id: "complete-the-request",
    name: "complete-the-request", title: "Complete the caller's request",
    task: "Complete the caller's request end-to-end.",
    subGoals: ["Understand what the caller wants", "Take the right action", "Confirm the outcome"],
    expected: "Agent completes the request within policy.", outcome: "Agent completes the request within policy.",
    turns: 4,
  }];
};

const taskKey = (t) => t.id || t.name;

/** The tasks a persona can be paired with, for the "Pick tasks" list. */
export const personaTaskOptions = (env, envState) => tasksOf(env, envState).map((t) => ({
  key: taskKey(t),
  title: t.title || t.task || t.name,
  kind: t.kind === "edge" ? "Edge case" : "Task",
}));

/* ── The persona's voice ─────────────────────────────────────────────── */

/* What the caller is ringing about, from the tool the task exercises —
   lookup_order → "check on my order", issue_refund → "get a refund". */
const MINE = /^(order|booking|card|account|refund|address|segment|transactions?|subscription|payment|delivery|shipment|reservation|ticket|plan|bill|claim)/;
const VERBS = [
  /* Things you're handed rather than look up: get_refund_quote → "get a refund quote". */
  [/^get_(?=.*(quote|estimate|label|voucher|code|receipt|invoice)$)/, (n) => `get ${a(n)}`],
  [/^(lookup|get|check|list|search|find|fetch)_/, (n) => `check on ${n}`],
  [/^issue_/, (n) => `get ${a(n)}`],
  [/^send_/, (n) => `get ${a(n)} sent`],
  [/^(create|open)_/, (n) => `set up ${a(n)}`],
  [/^apply_/, (n) => `get ${n} applied`],
  [/^(update|change)_/, (n) => `change ${n}`],
  [/^cancel_/, (n) => `cancel ${n}`],
  [/^verify_/, (n) => `confirm ${n}`],
  [/^escalate_/, () => "speak to a person"],
  [/^(freeze|block)_/, (n) => `freeze ${n}`],
  [/^(raise|file)_/, (n) => `raise ${a(n)}`],
  [/^(rebook|reschedule)_/, (n) => `rebook ${n}`],
  [/^generate_/, (n) => `get ${a(n)}`],
];
/* "my refund" → "a refund", "the otp" → "an otp". */
const a = (n) => {
  const bare = n.replace(/^(my|the) /, "");
  return `${/^[aeiou]/i.test(bare) ? "an" : "a"} ${bare}`;
};
const nounOf = (rest) => {
  const n = rest.replace(/_/g, " ").trim();
  return MINE.test(n) ? `my ${n}` : `the ${n}`;
};
const askFor = (tool) => {
  if (!tool) return null;
  for (const [re, fn] of VERBS) {
    if (re.test(tool)) return fn(nounOf(tool.replace(re, "")));
  }
  return `sort out ${nounOf(tool)}`;
};

/* Edge cases have no single tool — the situation itself is the ask. */
const EDGE_ASK = {
  "Ambiguous request": "sort out an order — I think there might be two under my name",
  "Missing information": "sort something out, though I don't have all the details to hand",
  "Stale record": "fix something — what you've got on file isn't right any more",
  "Conflicting sources": "get a straight answer — I've been told two different things",
  "Mid-task change of mind": "sort out one thing — actually, maybe something else",
  "Tool returns an error": "finish something I tried earlier that didn't go through",
};

/* How a persona carries a call, keyed off their personality and how they
   describe themselves. First match wins; order is most-distinctive first. */
const VOICES = [
  { re: /impatient|rush|hurr|busy|stressed/i, tone: "impatient", style: "terse",
    open: (ask) => `I don't have long — I need to ${ask}. Can we do this quickly?`,
    manner: "Short on time: pushes to move fast and gets curt if asked to repeat things." },
  { re: /anxious|distress|worried|emotional|upset|frustrat/i, tone: "urgent", style: "verbose",
    open: (ask) => `I'm really worried about this — I need to ${ask}, please.`,
    manner: "Anxious: needs reassurance and repeats concerns until they feel heard." },
  { re: /cautious|skeptic|sceptic|curious|evaluat/i, tone: "sceptical", style: "concise",
    open: (ask) => `Before anything happens, I want to understand — I'm calling to ${ask}.`,
    manner: "Cautious: questions answers and asks for confirmation before agreeing." },
  { re: /polite|friendly|cooperative|easy|loyal|senior|retired/i, tone: "polite", style: "casual",
    open: (ask) => `Hello, sorry to bother you — I was hoping you could help me ${ask}.`,
    manner: "Polite and patient: happy to answer questions and follow steps." },
  { re: /confused|first-time|newbie|lost|new /i, tone: "confused", style: "verbose",
    open: (ask) => `Hi, I'm not sure I'm in the right place — I think I need to ${ask}?`,
    manner: "Unsure: needs things explained plainly and may misunderstand steps." },
  { re: /analytic|detail|engineer|tech/i, tone: "neutral", style: "concise",
    open: (ask) => `I'd like to ${ask}. Please give me the specifics.`,
    manner: "Precise: asks for exact details and notices vague answers." },
  { re: /talkative|chatty|hustl/i, tone: "neutral", style: "chatty",
    open: (ask) => `So — long story, but basically I need to ${ask}.`,
    manner: "Talkative: wanders into side stories before the real ask." },
  { re: /reserved|quiet|shy/i, tone: "neutral", style: "terse",
    open: (ask) => `Hi. I need to ${ask}.`,
    manner: "Reserved: gives short answers and needs prompting for details." },
  { re: /professional|formal|confident|executive|admin|owner|vip|no-nonsense/i, tone: "neutral", style: "formal",
    open: (ask) => `Good afternoon. I need to ${ask}.`,
    manner: "Businesslike: expects a crisp, competent answer without small talk." },
];
/* Personality decides first, then how they're described, then how they
   talk — "Direct and concise" shouldn't make every caller impatient. */
const voiceOf = (p) => {
  const sources = [
    arr(p.personality).join(" "),
    [p.name, p.description].filter(Boolean).join(" "),
    arr(p.communicationStyle ?? p.communication_style).join(" "),
  ];
  for (const hay of sources) {
    const v = hay && VOICES.find((x) => x.re.test(hay));
    if (v) return v;
  }
  return {
    tone: "neutral", style: "casual",
    open: (ask) => `Hi — I need to ${ask}.`,
    manner: "Even-tempered: states the request and follows the agent's lead.",
  };
};

const ACCENT = { american: "US", us: "US", canadian: "US", british: "UK", uk: "UK", english: "UK", indian: "IN", brazilian: "BR", japanese: "JP", arabic: "AE", emirati: "AE" };
/* An accent the editor has no option for still isn't American — say "other". */
const accentOf = (p) => {
  const a = String(first(p.accent) || "").toLowerCase();
  return a ? (ACCENT[a] || "other") : null;
};

/* The task, written for this persona: their opening line as the summary the
   list shows, and a brief that says who's calling, how, and what the task
   still requires of the agent. */
const writeFor = (base, p) => {
  const voice = voiceOf(p);
  const tool = arr(base.requiredTools)[0];
  const ask = (base.kind === "edge" && EDGE_ASK[base.title]) || askFor(tool) || "get some help with something";
  const opening = voice.open(ask);
  const accent = accentOf(p);
  const brief = [
    /* The brief is about the caller, so "my order" reads "their order". */
    `${p.name} calls to ${ask.replace(/ — .*$/, "").replace(/\bmy\b/g, "their")}.`,
    voice.manner,
    `Opens with: “${opening}”`,
    base.kind === "edge" ? base.task : tool ? `The agent needs ${tool} to complete it.` : null,
  ].filter(Boolean).join(" ");
  return {
    summary: `“${opening}”`,
    opening,
    task: brief,
    situation: brief,
    ...callerFor(p, voice, accent),
  };
};

/* Tone and style from the persona's voice; language and background sound
   from its library settings. `callerFrom` records where they came from so
   the editor can say "from <persona>" and treat a change as an override. */
const callerFor = (p, voice = voiceOf(p), accent = accentOf(p)) => {
  const cs = callSettingsOf(p);
  return {
    caller: {
      tone: voice.tone,
      style: voice.style,
      ...(accent && { accent }),
      ...((cs.languages?.[0] || first(p.language)) && { language: cs.languages?.[0] || first(p.language) }),
    },
    callerFrom: p.name,
    ...(cs.backgroundSound != null && { backgroundNoise: cs.backgroundSound ? "high" : "none" }),
  };
};

/* ── Swapping one scenario's caller ───────────────────────────────────── */

/* Rows whose brief is just the task — routine tasks, edge cases and anything
   written from the library — can be rewritten in a new persona's voice.
   Rule probes and pressure tests script the caller's manner themselves, so
   only the caller changes there and the brief is kept. */
const rewritable = (row) => !!(row.opening || row.source === "persona-library"
  || /-core-\d+-routine$|-edge-\d+$/.test(row.id || "")
  || EDGE_ASK[row.title]);

/**
 * The patch for putting a library persona on an existing scenario: the
 * persona, its caller settings, and — where the brief is just the task — the
 * brief and opening line rewritten in its voice, so nothing still speaks for
 * the persona it replaced.
 */
export const personaSwapPatch = (row, libraryPersona) => {
  const persona = scenarioPersonaFrom(libraryPersona);
  if (!rewritable(row)) return { persona, ...callerFor(libraryPersona), rewrote: false };
  const kind = EDGE_ASK[row.title] || /-edge-\d+$/.test(row.id || "") ? "edge" : "task";
  const base = { ...row, kind, task: kind === "edge" ? baseEdgeTask(row) : row.task };
  return { persona, ...writeFor(base, libraryPersona), rewrote: true };
};

/* An edge case's own situation, without a previous persona's framing. */
const baseEdgeTask = (row) => {
  const t = String(row.task || "");
  const i = t.lastIndexOf("” ");
  return i >= 0 ? t.slice(i + 2) : t;
};

/* ── Writing the batch ───────────────────────────────────────────────── */

/* Title a task is matched on — the same key the duplicate check uses. */
const titleOf = (t) => t.title || t.task || "Scenario";

/*
  The environment's tasks, least-covered first: tasks the chosen personas
  haven't played here come before ones they have (those would only be
  skipped as duplicates), then tasks no library persona has played before
  ones that already have a caller from the library. Ties keep the
  environment's own order, so the choice is stable.
*/
const byCoverage = (tasks, envState, personas) => {
  const lib = (envState?.scenarios || []).filter((s) => s.persona?.libraryId != null);
  const ids = new Set(personas.map((p) => String(p.id)));
  const coverage = new Map();
  const mine = new Map();
  lib.forEach((s) => {
    coverage.set(s.title, (coverage.get(s.title) || 0) + 1);
    if (ids.has(String(s.persona.libraryId))) mine.set(s.title, (mine.get(s.title) || 0) + 1);
  });
  return tasks
    .map((t, i) => ({ t, i, mine: mine.get(titleOf(t)) || 0, cov: coverage.get(titleOf(t)) || 0 }))
    .sort((x, y) => x.mine - y.mine || x.cov - y.cov || x.i - y.i)
    .map((x) => x.t);
};

/**
 * Which tasks each persona gets, in one of four plans:
 *   same   — the same `per` least-covered tasks for every persona, so results
 *            compare persona to persona on one task (the default)
 *   spread — `per` different tasks each, for breadth across the environment
 *   every  — every task, for each persona
 *   pick   — the chosen tasks (`taskKeys`), for each persona
 */
export const planTasks = (env, envState, personas, { mode = "same", per = 2, taskKeys = [] } = {}) => {
  const tasks = tasksOf(env, envState);
  if (mode === "every") return personas.map(() => tasks);
  if (mode === "pick") {
    const chosen = tasks.filter((t) => taskKeys.includes(taskKey(t)));
    return personas.map(() => chosen);
  }
  const ranked = byCoverage(tasks, envState, personas);
  if (mode === "same") {
    const chosen = ranked.slice(0, Math.min(per, ranked.length));
    return personas.map(() => chosen);
  }
  return personas.map((_, pi) => Array.from({ length: per }).map((__, i) => ranked[(pi * per + i) % ranked.length]));
};

/* A persona already met on a task here — adding it again would only make a
   duplicate. Keyed by library id and task title. */
const pairKey = (libraryId, title) => `${libraryId}::${title}`;
const existingPairs = (envState) => new Set((envState?.scenarios || [])
  .filter((s) => s.persona?.libraryId != null)
  .map((s) => pairKey(s.persona.libraryId, s.title)));

/** What a plan would add once duplicates are skipped. */
export const previewBatch = (env, envState, personas, plan = {}) => {
  const have = existingPairs(envState);
  const perPersona = planTasks(env, envState, personas, plan);
  let fresh = 0;
  let skipped = 0;
  personas.forEach((p, pi) => perPersona[pi].forEach((base) => {
    if (have.has(pairKey(p.id, titleOf(base)))) skipped += 1;
    else fresh += 1;
  }));
  return { fresh, skipped };
};

export const scenariosForPersonas = (env, envState, personas, plan = {}) => {
  const stamp = Date.now().toString(36);
  const have = existingPairs(envState);
  const perPersona = planTasks(env, envState, personas, plan)
    .map((tasks, pi) => tasks.filter((base) => !have.has(pairKey(personas[pi].id, titleOf(base)))));
  const rows = personas.flatMap((p, pi) => perPersona[pi].map((base, i) => {
    /* A new scenario: drop the base row's identity, provenance and proof —
       including any "broke after the env changed" flags it picked up — so
       stampNewBatch proves it fresh on the current environment version. The
       tools it exercises stay: they're the task's, not the caller's. */
    const {
      id, addedAt, addedBy, batchId, provedAgainst, provedAt, addedInEnv, kind,
      provedBroke, brokeReasons, brokeAgainst, runs, lastRun, result, status, ...rest
    } = base;
    return {
      ...rest,
      ...writeFor(base, p),
      id: `lib-${slug(p.name)}-${stamp}-${pi}-${i}`,
      /* The task, then who plays it — e.g. fetch-an-order-its-status--acme-vip-account. */
      name: `${words(base.title || base.name || "scenario", 5)}--${words(p.name, 3)}`,
      title: base.title || base.task || "Scenario",
      persona: scenarioPersonaFrom(p),
      source: "persona-library",
      surface: env?.surface || base.surface,
    };
  }));
  const skipped = planTasks(env, envState, personas, plan).reduce((n, t, pi) => n + t.length - perPersona[pi].length, 0);
  return { ...stampNewBatch(rows, { env, envState, source: "persona-library" }), skipped };
};

const MODE_SHAPE = {
  same: "same tasks",
  spread: "different tasks",
  every: "every task",
  pick: "chosen tasks",
};

/* "A, B and 3 more" — the first couple of task names, so the footer says
   what you're getting without becoming a list. */
const nameTasks = (titles, show = 2) => {
  const quoted = titles.map((t) => `“${t}”`);
  if (quoted.length <= show) return quoted.join(" and ");
  return `${quoted.slice(0, show).join(", ")} and ${quoted.length - show} more`;
};

/**
 * What a plan will add, in words — for the footer next to the add button.
 * Names the tasks, says what's skipped as already there, and what a large
 * batch costs per run. `tasks` is the full list, for a hover.
 */
export const planSummary = (env, envState, personas, plan, { repeats = 3 } = {}) => {
  const n = personas.length;
  if (!n) return null;
  if (plan.mode === "pick" && !(plan.taskKeys || []).length) {
    return { total: 0, tasks: [], text: "Choose which of this environment's tasks each persona gets." };
  }
  const perPersona = planTasks(env, envState, personas, plan);
  const { fresh: total, skipped } = previewBatch(env, envState, personas, plan);
  const titles = [...new Set(perPersona.flat().map(titleOf))];
  const who = n === 1 ? personas[0].name : n === 2 ? "both personas" : `all ${n} personas`;
  const what = plan.mode === "every"
    ? `${who} ${n === 1 ? "does" : "do"} every task (${titles.length})`
    : plan.mode === "spread" && n > 1
      ? `${n} personas, different tasks each: ${nameTasks(titles)}`
      : `${who} ${n === 1 ? "does" : "do"} ${nameTasks(titles)}`;
  const parts = [
    total
      ? `${total} new scenario${total === 1 ? "" : "s"} — ${what}`
      : `Nothing new — ${n === 1 ? "this persona already has" : "these personas already have"} these tasks here`,
    skipped && total ? `${skipped} already here, skipped` : null,
    total >= 20 ? `about ${total * repeats} calls per run at ${repeats} repeats` : null,
  ].filter(Boolean);
  return { total, tasks: titles, shape: MODE_SHAPE[plan.mode], text: parts.join(" · ") };
};

/** Environments with a caller — the ones library personas can play in. */
const CALLER_SURFACES = ["voice", "chat", "messaging", "email", "multi"];
export const usesPersonaLibrary = (env) => CALLER_SURFACES.includes(env?.surface);

/** "voice" / "text" — the persona library's agent type for an environment. */
export const personaTypeFor = (env) => (env?.surface === "voice"
  ? "voice"
  : ["chat", "messaging", "email"].includes(env?.surface) ? "text" : null);

/** Where a task plan starts: the same two least-covered tasks for every persona. */
export const DEFAULT_TASK_PLAN = { mode: "same", per: 2, taskKeys: [] };

/* ── Between a scenario's persona and the library ────────────────────── */

/** Where a scenario's persona came from, for the label beside it. */
export const personaOrigin = (persona) => {
  if (!persona) return null;
  if (persona.libraryId == null) return { kind: "generated", label: "Written for this scenario" };
  return persona.edited
    ? { kind: "edited", label: `Based on ${persona.libraryName || persona.name} · edited here` }
    : { kind: "library", label: "From persona library" };
};

const AGE_BUCKETS = [[25, "18-25"], [32, "25-32"], [40, "32-40"], [50, "40-50"], [60, "50-60"], [Infinity, "60+"]];
const ageBucket = (persona) => {
  const n = parseInt(persona.age ?? persona.ageGroup, 10);
  if (Number.isNaN(n)) return [];
  return [AGE_BUCKETS.find(([max]) => n < max)[1]];
};

/**
 * A scenario's persona as starting values for Create persona — so a caller
 * the builder wrote (or one edited here) can be kept and reused elsewhere.
 * Free-form traits don't map onto the library's personality options, so they
 * travel as the persona's instructions instead of being dropped.
 */
export const libraryPrefillFrom = (persona, row) => {
  const gender = String(persona?.gender || "").toLowerCase();
  const traits = arr(persona?.traits).filter(Boolean);
  return {
    name: persona?.name || "",
    description: persona?.description || persona?.role || (row?.title ? `Caller for “${row.title}”.` : ""),
    gender: ["male", "female"].includes(gender) ? [gender] : [],
    ageGroup: ageBucket(persona || {}),
    additionalInstruction: traits.length ? `Traits: ${traits.join(", ")}.` : null,
  };
};

/** A library persona's call settings in one line, for the scenario editor. */
export const callSettingsLine = (cs, { voice } = {}) => {
  if (!cs) return null;
  const bits = voice
    ? [
      cs.speed != null && `speaks at ${cs.speed}×`,
      cs.interruptSensitivity != null && `interrupt sensitivity ${cs.interruptSensitivity}/10`,
      cs.finishedSpeakingSensitivity != null && `jumps in at ${cs.finishedSpeakingSensitivity}/10`,
      cs.backgroundSound != null && (cs.backgroundSound ? "background sound on" : "quiet line"),
    ]
    : [
      cs.tone && `tone ${String(cs.tone).toLowerCase()}`,
      cs.verbosity && `${String(cs.verbosity).toLowerCase()} replies`,
      cs.typos && `typos ${String(cs.typos).toLowerCase()}`,
      cs.slang && `slang ${String(cs.slang).toLowerCase()}`,
      cs.emoji && `emoji ${String(cs.emoji).toLowerCase()}`,
    ];
  const langs = cs.languages?.length ? [`speaks ${cs.languages.join(", ")}`] : [];
  const out = [...bits.filter(Boolean), ...langs];
  return out.length ? out.join(" · ") : null;
};
