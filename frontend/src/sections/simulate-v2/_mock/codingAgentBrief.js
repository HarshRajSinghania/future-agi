/**
 * "Copy for coding agent" — a failure handed to Claude Code, Cursor or Codex
 * as one markdown brief.
 *
 * The coding agent can do the editing; what it cannot do is see what Future
 * AGI saw. So the brief carries the evidence, the agent's constraints and the
 * one step that turns its edit into a candidate — and says plainly what it
 * may not touch. A brief without the submit step produces a diff nobody
 * measures; a brief without the constraints produces one the run rejects.
 */
import { submitStepOf } from "./candidateRoute";
import { KIND_SURFACE } from "./optimizer";
import { limitRows } from "./optimizationRuns";
import { changeFileFor } from "./optimize";
import { scrubPersonalData } from "./rsiModel";

/* What each surface reads as in a sentence — "Changes tool descriptions". */
const SURFACE_WORDS = {
  prompt: "prompts", tools: "tool descriptions", settings: "agent settings", code: "code", structure: "structure",
};

/* Fixes to the measurement — they mint an environment version, not an agent one. */
const ENV_KINDS = ["Verifier", "Reward spec"];

/* A protected entry is a path in the agent's own tree ("prompts/system.md");
   a change names it under the environment ("airline/prompts/system.md"). */
const isProtected = (path, list = []) => !!path && list.some((p) => path === p || path.endsWith(`/${p}`));

/**
 * Which of the agent's constraints a proposed fix touches.
 *
 * Not allowed is said, not hidden — the card stays, with the reason and the
 * way to change it.
 */
export const fixScope = (proposal, { env, limits } = {}) => {
  if (ENV_KINDS.includes(proposal?.kind)) {
    return { surface: "environment", environment: true, ok: true, label: "Changes the environment's checks, not the agent" };
  }
  const surface = KIND_SURFACE[proposal?.kind] || "code";
  const path = changeFileFor(env, proposal)?.path || null;
  const allowed = (limits?.allowed || []).includes(surface);
  const locked = isProtected(path, limits?.protected);
  return {
    surface,
    path,
    allowed,
    protected: locked,
    ok: allowed && !locked,
    label: `Changes ${SURFACE_WORDS[surface] || surface}`,
  };
};

/* Said to the coding agent as an instruction, not a status. */
const scopeNote = (s) => {
  if (!s) return "";
  if (s.environment) return `${s.label.toLowerCase()} — not yours to make; Future AGI applies it`;
  if (!s.allowed) return `${s.label.toLowerCase()} — not allowed for this agent; do not make this change`;
  if (s.protected) return `${s.label.toLowerCase()} — edits ${s.path}, which this agent protects; do not edit it`;
  return `${s.label.toLowerCase()} — allowed`;
};

const asText = (x) => (typeof x === "string" ? x : x?.title || x?.text || "");
const bullets = (list) => list.map((x) => `- ${x}`);

/**
 * The brief, as markdown.
 *
 *   agent            { name, key }
 *   env              { id, name }
 *   issue            { title, severity?, id? } or a string
 *   rootCause        string
 *   suggestedFix     string, or fixes: { title, kind?, why?, diff?, scope? }
 *   evidence         strings, or { source, text } — the first five are used
 *   failingScenarios strings or { title }
 *   limits, model    the agent's constraints, as limitRows reads them
 *   submit           optional — replaces the default submit step
 *   runId            optional — the run the evidence came from
 *   proof            optional — { label, tierLabel } from proofKindOf
 *   members          optional — the members the change touches, by name
 *   names            optional — real names to replace in the evidence
 *
 * Evidence comes from production: every excerpt goes through
 * scrubPersonalData before it is copied or handed to a coding agent — names,
 * numbers and addresses become realistic fake values — and the brief says so.
 */
export const codingAgentBrief = ({
  agent, env, issue, rootCause, suggestedFix, evidence = [], failingScenarios = [], limits, model, submit, runId, proof, members, names = [], pairing = null,
}) => {
  const title = asText(issue) || "Failing scenarios";
  const severity = typeof issue === "object" ? issue?.severity : null;
  const agentKey = agent?.key || "<agent>";
  const envId = env?.id || "<environment>";

  const fixes = Array.isArray(suggestedFix) ? suggestedFix : null;
  const fixLines = fixes
    ? fixes.flatMap((f, i) => [
      `${i + 1}. **${f.title}**${f.kind ? ` (${f.kind}${f.scope ? `; ${scopeNote(f.scope)}` : ""})` : ""}`,
      ...(f.why ? [`   ${f.why}`] : []),
      ...(f.diff || []).map((d) => `   ${d.type === "remove" ? "-" : "+"} ${d.text}`),
    ])
    : [suggestedFix || "No fix proposed yet — start from the root cause."];

  /* The problem, not the person. */
  let replaced = 0;
  const excerpts = evidence.slice(0, 5).map((e) => {
    const raw = typeof e === "string" ? e : `${e.source ? `${e.source}: ` : ""}${e.text}`;
    const clean = scrubPersonalData(raw, { names });
    replaced += clean.count;
    return clean.text;
  });
  const scenarios = failingScenarios.map(asText).filter(Boolean);
  const more = scenarios.length > 12 ? scenarios.length - 12 : 0;

  return [
    `# ${title}`,
    "",
    [
      agent?.name && `Agent: ${agent.name} (\`${agentKey}\`)`,
      env?.name && `Environment: ${env.name} (\`${envId}\`)`,
      severity && `Severity: ${severity}`,
      issue?.id && `Issue: ${issue.id}`,
      runId && `Run: ${runId}`,
      /* "agent v3 × env v7" — the environment version stays fixed; only the agent changes. */
      pairing && `Measured on: ${pairing}`,
      proof && `Proof: ${proof.label} · ${proof.tierLabel}${proof.kind === "live" ? " — tools reached your real systems" : ""}`,
      members?.length && `Changes: ${members.join(", ")}`,
    ].filter(Boolean).join("  \n"),
    "",
    "## Root cause",
    rootCause || "Not analysed yet.",
    "",
    "## Suggested fix",
    ...fixLines,
    "",
    ...(excerpts.length ? [
      "## Evidence",
      `_Personal data replaced — names, phone numbers, emails, addresses and account numbers are realistic fake values${replaced ? ` (${replaced} replaced)` : ""}. The problem is kept, not the person._`,
      "",
      ...excerpts.map((e) => `> ${e}`).flatMap((e) => [e, ""]),
    ] : []),
    ...(scenarios.length ? [
      "## Failing scenarios",
      ...bullets(scenarios.slice(0, 12)),
      ...(more ? [`- …and ${more} more`] : []),
      "",
    ] : []),
    "## Constraints",
    ...bullets(limitRows(limits, model).map((r) => `${r.label}: ${r.value}`)),
    "",
    "## Submit a candidate",
    /* What to submit depends on where the agent lives — a commit, a settings
       patch, a draft version (candidateRoute). */
    submit || submitStepOf(agent, envId),
    "",
    "You can propose changes but cannot change the scenarios or the grading.",
    "",
  ].join("\n");
};
