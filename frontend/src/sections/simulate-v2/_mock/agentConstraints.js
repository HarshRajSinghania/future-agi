/*
  The parts of an agent its constraints can name, and how a cost ceiling
  reads. Pure, so the Constraints tab, the connect step and the checks all
  read the same entries the same way.

  Protected parts share one list:
    "prompts/system.md"                   a file
    "tool:lookup_order"                   a tool
    "section:prompts/system.md#Closing"   a section of a prompt file
*/

/* Sections a system prompt is taken to have when it names none of its own —
   the ones a prompt change is matched against. */
export const DEFAULT_SECTIONS = ["Greeting", "Identity checks", "Policies", "Tool use", "Closing"];

/* Added under the prompt when a later version syncs a rule in — not a
   section anyone wrote. */
const SYNCED_HEADING = "Additional rules";

const baseName = (p) => String(p || "").replace(/^.*\//, "");

export const PART_ICON = {
  file: "solar:file-text-linear",
  tool: "solar:code-square-linear",
  section: "solar:hashtag-linear",
};

/** One protected entry, read: { entry, kind, label, name?, file?, heading? }. */
export const protectedPartOf = (entry) => {
  const s = String(entry || "");
  if (s.startsWith("tool:")) return { entry: s, kind: "tool", name: s.slice(5), label: s.slice(5) };
  if (s.startsWith("section:")) {
    const [file, ...rest] = s.slice(8).split("#");
    const heading = rest.join("#");
    return { entry: s, kind: "section", file, heading, label: `${baseName(file)} › ${heading}` };
  }
  return { entry: s, kind: "file", label: s };
};

/** "# Policies" and "## Tool use" — a prompt file's own sections, in order. */
export const headingsOf = (content) => [...new Set(String(content || "").split("\n")
  .map((line) => line.match(/^#{1,2}\s+(.+?)\s*#*\s*$/)?.[1])
  .filter(Boolean))];

/**
 * Everything on an agent that can be protected, from its files: the files
 * themselves, its tools, and the sections of its prompt files. A system
 * prompt without headings of its own offers the default sections.
 */
export const protectablePartsOf = (files = []) => {
  const prompts = files.filter((f) => f.group === "Prompts" && /\.md$/i.test(f.path));
  const system = prompts.find((f) => /(^|\/)(system|instructions)\.md$/i.test(f.path)) || prompts[0];
  return {
    /* A tool is protected as a tool, not as the file it's declared in. */
    files: files.filter((f) => f.group !== "Tools").map((f) => f.path),
    tools: [...new Set(files.filter((f) => f.group === "Tools").map((f) => baseName(f.path).replace(/\.(json|py)$/, "")))],
    sections: prompts.flatMap((f) => {
      const own = headingsOf(f.content);
      const authored = own.some((h) => h !== SYNCED_HEADING);
      const list = authored || f !== system ? own : [...DEFAULT_SECTIONS, ...own];
      return list.map((h) => `section:${f.path}#${h}`);
    }),
  };
};

/* ── cost ceiling ─────────────────────────────────────────────────────── */

/* Fixed amounts a conversation may cost, in US dollars. */
export const COST_ABS_STEPS = [0.05, 0.08, 0.1, 0.12, 0.15, 0.2];

export const dollarsLabel = (n) => `$${Number(n || 0).toFixed(2)}`;

/** "pct" — no more than a percentage above today's agent; "abs" — a fixed amount. */
export const costModeOf = (limits) => (limits?.costMode === "abs" ? "abs" : "pct");

/** The amount to start from when switching to one: the first step above today's cost. */
export const defaultCostAbs = (measured) => (measured == null ? 0.12
  : COST_ABS_STEPS.find((n) => n >= measured) ?? COST_ABS_STEPS[COST_ABS_STEPS.length - 1]);

/** "At most +5%" or "At most $0.12" — the cost ceiling, said the same way everywhere. */
export const costLimitLabel = (limits) => {
  if (costModeOf(limits) === "abs") return `At most ${dollarsLabel(limits.costCeilingAbs ?? defaultCostAbs())}`;
  const n = limits?.costCeiling ?? 0;
  return n <= 0 ? "No increase" : `At most +${n}%`;
};
