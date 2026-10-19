/**
 * What an agent version pins.
 *
 * A version is a snapshot of everything that decides behaviour, so it names
 * each part precisely enough to get back to it: the code at a commit (a
 * repository, or code wrapped by our SDK adapter), the platform's own config
 * version (Vapi, Retell…), or the prompt revision (built in Future AGI) — and
 * always a fingerprint of the tool definitions, because a tool changes what an
 * agent can do without touching a line of its prompt.
 *
 * Mixed sources pin together on one version: the commit of a repository
 * linked to a hosted or built-in agent, each Future AGI prompt it loads
 * (`values.fagiPrompts`, or the version's own `fagiPrompts` snapshot) at its
 * version, the platform config version, and the tools fingerprint. An agent
 * with neither a linked repository nor Future AGI prompts pins exactly what
 * it always did.
 *
 * Derived, never stored. Every pin is a deterministic function of what the
 * version record already carries — label, tools, changes, the agent's
 * identity — so versions saved before pins existed read the same way.
 */

/* FNV-1a, then a multiplicative scramble so neighbouring labels ("v2", "v3")
   don't produce neighbouring digits. */
const hash = (s) => {
  let h = 0x811c9dc5;
  const str = String(s || "");
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
const hex = (s, n) => (Math.imul(hash(s), 2654435761) >>> 0).toString(16).padStart(8, "0").slice(-n);

/* The version a version was built from — its recorded parent, else the one
   before it. The same rule parentLabel and toolFit follow. */
const parentIndex = (versions, i) => {
  const own = versions[i]?.basedOnVersion;
  const at = own && own !== versions[i].label ? versions.findIndex((v) => v.label === own) : -1;
  if (at >= 0 && at < i) return at;
  return i > 0 ? i - 1 : -1;
};

/* Name and description are the definition; argument order and the version
   they arrived in are not. Sorted, so reordering the list changes nothing. */
const toolsFingerprint = (tools) => hex(
  (tools || [])
    .map((t) => `${t.name}\u0001${t.desc || t.description || ""}`)
    .sort()
    .join("\u0002"),
  6,
);

/* Did this version touch the prompt? Edits recorded on the version, or code
   changes from an improvement whose file or kind is the prompt. */
const PROMPTISH = /prompt|instruction/i;
const touchesPrompt = (v) => (v.changes || []).some((c) => c.kind === "instructions" || typeof c.prompt === "string" || PROMPTISH.test(c.kind || ""))
  || (v.applied || []).some((a) => PROMPTISH.test(`${a.path || ""} ${a.kind || ""} ${a.file || ""}`));

/* The first pin — what the agent's own definition is held at — by source. */
const CODE_PIN = {
  repo: "commit",
  framework: "commit",
  upload: "bundle",
  platform: "config",
  builtin: "prompt",
  prompt: "prompt",
};

/* Future AGI prompts the agent loads — what the connect step recorded, plus
   any added or removed later on Connections (`addedAt` / `removedAt`), so a
   prompt added today never shows up on a version saved before it. */
const fagiPromptsOf = (list) => (Array.isArray(list) ? list : [])
  .filter((p) => p && (p.promptId || p.name))
  .map((p) => ({ promptId: p.promptId || p.name, name: p.name || p.promptId, version: p.version || "v1", addedAt: p.addedAt || null, removedAt: p.removedAt || null }));
const loadedAt = (list, v) => {
  const at = Date.parse(v.createdAt || v.connectedAt || "") || 0;
  return list.filter((p) => (!p.addedAt || (at && Date.parse(p.addedAt) <= at)) && !(p.removedAt && (!at || Date.parse(p.removedAt) <= at)));
};

/**
 * `{ [label]: { pins, text, tip } }` for every version of one agent.
 *
 *   pins   [{ id: "code" | "commit" | "fagi:<promptId>" | "tools", label, value, text }]
 *          — "commit 3f9a2c1", "Refund policy v4", "Vapi config v14",
 *          "prompt v6", then always "tools 9f2e41"
 *   text   the pins on one line, for a quiet mono caption
 *   tip    a sentence that says what each pin means
 *
 * `toolsOf(label)` resolves a version's tools when the caller knows the
 * world the agent was read in; otherwise the agent's own declared tools.
 */
export const versionPinsOf = ({ agent, source, toolsOf }) => {
  const versions = agent?.versions || [];
  const key = agent?.key || agent?.id || agent?.name || "agent";
  const kind = CODE_PIN[source?.kind] ? source.kind : null;
  /* A repository linked to an agent that isn't read from one — where its
     tools' code lives. Its commit is pinned too. */
  const linkedRepo = kind && !["repo", "framework", "upload"].includes(kind)
    ? agent?.definition?.repoUrl || agent?.values?.linkedRepo || null
    : null;
  const agentFagi = fagiPromptsOf(agent?.values?.fagiPrompts);
  const out = {};
  const promptRev = [];
  const configRev = [];
  const toolsFp = [];
  const toolsCount = [];

  versions.forEach((v, i) => {
    const p = parentIndex(versions, i);

    /* Tools: a version that didn't change them carries its parent's
       fingerprint, whatever else changed. */
    if (v.tools) { toolsFp[i] = toolsFingerprint(v.tools); toolsCount[i] = v.tools.length; }
    else if (p >= 0) { toolsFp[i] = toolsFp[p]; toolsCount[i] = toolsCount[p]; }
    else {
      const list = toolsOf?.(v.label) || agent?.definition?.tools || [];
      toolsFp[i] = toolsFingerprint(list);
      toolsCount[i] = list.length;
    }
    const toolsSame = p >= 0 && toolsFp[p] === toolsFp[i];

    /* Revisions are one line even when versions branch: an edit made on top
       of an older version is still the newest revision there is. */
    const newest = (revs) => Math.max(...revs.slice(0, i));
    /* The prompt only moves when the version edited it. The first version
       pins whatever revision was current when it was connected. */
    promptRev[i] = p < 0 ? 1 + (hash(`${key}:prompt`) % 5)
      : touchesPrompt(v) ? newest(promptRev) + 1 : promptRev[p];
    /* A hosted platform bumps its config on every save — ours and the ones
       made in its own dashboard between our versions. */
    configRev[i] = p < 0 ? 3 + (hash(`${key}:config`) % 9)
      : newest(configRev) + 1 + (hash(`${key}:${v.label}:config`) % 3);

    let code = null;
    if (kind === "repo" || kind === "framework") {
      const sha = v.commit?.sha || hex(`${key}:${v.label}:commit`, 7);
      code = { id: "code", label: "commit", value: sha, text: `commit ${sha}` };
    } else if (kind === "upload") {
      const b = hex(`${key}:${v.label}:bundle`, 7);
      code = { id: "code", label: "bundle", value: b, text: `bundle ${b}` };
    } else if (kind === "platform") {
      const name = source.label && source.label !== "Hosted platform" ? `${source.label} config` : "config";
      code = { id: "code", label: name, value: `v${configRev[i]}`, text: `${name} v${configRev[i]}` };
    } else if (kind === "builtin" || kind === "prompt") {
      code = { id: "code", label: "prompt", value: `v${promptRev[i]}`, text: `prompt v${promptRev[i]}` };
    }
    /* The fingerprint tells versions apart; people see how many tools it has. */
    const nTools = `${toolsCount[i]} tool${toolsCount[i] === 1 ? "" : "s"}`;
    const tools = { id: "tools", label: "tools", value: toolsFp[i], text: nTools };
    const commit = linkedRepo
      ? (() => { const sha = v.commit?.sha || hex(`${key}:${v.label}:commit`, 7); return { id: "commit", label: "commit", value: sha, text: `commit ${sha}` }; })()
      : null;
    const fagi = (v.fagiPrompts ? fagiPromptsOf(v.fagiPrompts) : loadedAt(agentFagi, v)).map((fp) => ({
      id: `fagi:${fp.promptId}`, label: fp.name, value: fp.version, text: `${fp.name} ${fp.version}`, fagi: true,
    }));
    /* Code first, then the prompts it loads, then the platform's own config,
       then the tools — with neither extra, exactly [code, tools] as before. */
    const codeFirst = code && ["commit", "bundle"].includes(code.label);
    const pins = [codeFirst ? code : commit, ...fagi, codeFirst ? null : code, tools].filter(Boolean);

    const codeTip = !code ? null
      : code.label === "commit" ? `the code at commit ${code.value}`
        : code.label === "bundle" ? `the uploaded bundle ${code.value}`
          : code.label === "prompt" ? `prompt revision ${code.value}`
            : code.text;
    const toolsTip = toolsSame
      ? `its ${nTools}, unchanged from ${versions[p].label}`
      : `its ${nTools}`;
    const extraTips = [
      commit && `the linked repository at commit ${commit.value}`,
      ...fagi.map((fp) => `the Future AGI prompt "${fp.label}" at ${fp.value}`),
    ].filter(Boolean);
    const tips = [...(codeFirst || !commit ? [codeTip] : []), ...extraTips, ...(!codeFirst && commit ? [codeTip] : []), toolsTip].filter(Boolean);
    out[v.label] = {
      pins,
      text: pins.map((x) => x.text).join(" · "),
      tip: `Pins ${tips.length > 2 ? `${tips.slice(0, -1).join(", ")} and ${tips[tips.length - 1]}` : tips.join(" and ")}. The tool definitions change only when a tool is added, removed or redescribed.`,
    };
  });
  return out;
};

/**
 * Two versions' pins side by side, for a compare header: "commit 3f9a2c1 →
 * 8ab12cd · tools 9f2e41 unchanged". `changed` marks the pins that moved.
 */
export const pinsDiff = (a, b) => (b?.pins || []).map((pin) => {
  const was = (a?.pins || []).find((x) => x.id === pin.id);
  const changed = !was || was.value !== pin.value;
  return { id: pin.id, label: pin.label, from: was?.value || null, to: pin.value, changed };
});
