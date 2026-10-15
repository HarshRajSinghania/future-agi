/*
  A run's candidate, taken from a code snapshot instead of an agent version:
  a commit SHA on the agent's repository, or an uploaded archive of its code.
  Carried on the run URL as `?candidate=sha:<sha>` or
  `?candidate=upload:<file name>`, stamped on the run record
  (`candidateSource`), and said on the run header as "from snapshot <sha>" —
  an archive's snapshot is the content hash it was stored under.

  Deterministic: an archive's hash is a fingerprint of its name.
*/
import { definitionOf } from "./agentRegistry";

const hex = (s) => {
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 7);
};

const SHA = /^[0-9a-f]{7,40}$/i;

/** Agents whose code we read — the ones a snapshot can be taken of. */
export const takesSnapshot = (agent) => ["repo", "upload", "framework"].includes(definitionOf(agent)?.kind);

/** The archives this agent's code was uploaded as before — the mock picker's list. */
export const uploadedArchivesOf = (agent) => {
  const def = definitionOf(agent) || {};
  const base = String(def.bundle || def.repoUrl || "agent").split("/").pop().replace(/\.(zip|tar|tgz|gz)$/i, "") || "agent";
  return [`${base}-fix.zip`, `${base}-candidate.tar.gz`];
};

/** `?candidate=` → { kind: "commit" | "upload", sha, name?, param, label, detail } or null. */
export const candidateSourceOf = (param, agent) => {
  if (!param) return null;
  const [kind, ...rest] = String(param).split(":");
  const value = rest.join(":").trim();
  if (!value) return null;
  if (kind === "sha" && SHA.test(value)) {
    const sha = value.slice(0, 7).toLowerCase();
    const repo = definitionOf(agent)?.repoUrl?.replace(/^https?:\/\/github\.com\//, "") || "the agent's repository";
    return { kind: "commit", sha, param: `sha:${value}`, label: `from snapshot ${sha}`, detail: `Commit ${sha} on ${repo}, built into a sealed snapshot for this run.` };
  }
  if (kind === "upload") {
    const sha = hex(value);
    return { kind: "upload", sha, name: value, param: `upload:${value}`, label: `from snapshot ${sha}`, detail: `Uploaded archive ${value}, stored as snapshot ${sha} for this run.` };
  }
  return null;
};

/** The URL value for a pick. */
export const candidateParam = ({ kind, value }) => (kind === "commit" ? `sha:${value}` : `upload:${value}`);
export const isSha = (v) => SHA.test(String(v || "").trim());
