import { keyLacksCreateScope } from "./replication";

/*
  Secrets by reference (PRD v6 AC-6.12, §1 preflight, AC-23.1b).

  A credential is captured as a pointer into the team's secret manager —
  `vault://acme/sim/vapi_api_key`, `aws-sm://prod/agents/openai` — never as
  the value. The reference can be shown, logged, exported and diffed without
  redaction; the value only ever exists inside the sandbox that resolves it.

  Changing a reference re-runs the access check (preflight) and nothing else:
  no rebuild, no new environment version. Which key a run used is not part of
  the world — what that key may do is, and the check reports it.
*/

export const SECRET_STORES = [
  { scheme: "vault", label: "HashiCorp Vault" },
  { scheme: "aws-sm", label: "AWS Secrets Manager" },
  { scheme: "gcp-sm", label: "GCP Secret Manager" },
  { scheme: "azure-kv", label: "Azure Key Vault" },
  { scheme: "op", label: "1Password" },
  { scheme: "doppler", label: "Doppler" },
];

const SCHEMES = SECRET_STORES.map((s) => s.scheme).join("|");
const REF_RE = new RegExp(`^(${SCHEMES})://[A-Za-z0-9._-]+(/[A-Za-z0-9._:-]+)+$`);

/** Whether a string is a secret-manager reference. */
export const isSecretRef = (s) => REF_RE.test(String(s || "").trim());

/** The store a reference points into — "HashiCorp Vault". */
export const storeOfRef = (ref) => {
  const scheme = String(ref || "").split("://")[0];
  return SECRET_STORES.find((s) => s.scheme === scheme) || null;
};

/*
  What a pasted secret looks like. Provider prefixes first (OpenAI, Stripe,
  AWS, GitHub, Slack, GitLab), then a JWT, then anything long, unbroken and
  mixed enough to be a token — and a masked value copied off a screen counts
  too, since it was a raw key before someone elided it.
*/
const RAW_PREFIX = /^(sk|pk|rk)[-_]|^sk-proj-|^AKIA[0-9A-Z]{8,}|^(ghp|gho|ghs|github_pat|glpat|xox[abprs])[-_]|^eyJ[\w-]+\.[\w-]+/;
export const looksLikeRawKey = (s) => {
  const v = String(s || "").trim();
  if (!v || isSecretRef(v)) return false;
  if (RAW_PREFIX.test(v)) return true;
  if (/[…•]/.test(v)) return true;
  return !/\s|:\/\//.test(v) && v.length >= 20 && /[A-Za-z]/.test(v) && /\d/.test(v);
};

export const RAW_KEY_MESSAGE = "That looks like a raw key. Store it in your secret manager and paste the reference.";

/*
  Demo: a connect form takes whatever key is typed so a walkthrough isn't
  stopped at the credential. What it records is still a reference — the
  slot the field names (its placeholder) — never the typed text.
*/
export const DEMO_ANY_KEY = true;
/** The reference a key field records: the reference typed, or in the demo the field's own slot. */
export const keyRefOf = (input, slot) => {
  const v = String(input || "").trim();
  if (!v) return "";
  if (isSecretRef(v)) return v;
  return DEMO_ANY_KEY && isSecretRef(slot) ? slot : "";
};

/** Accept a reference, or say plainly why not. */
export const validateSecretRef = (input) => {
  const v = String(input || "").trim();
  if (!v) return { ok: false, error: "Paste a reference to the secret." };
  if (looksLikeRawKey(v)) return { ok: false, error: RAW_KEY_MESSAGE, raw: true };
  if (!isSecretRef(v)) return { ok: false, error: "Use a secret-manager reference, for example vault://acme/sim/openai_api_key." };
  return { ok: true, ref: v };
};

/** The workspace's default path for a secret — where a migrated value was moved to. */
export const defaultRefFor = (name) => `vault://acme/sim/${String(name || "secret").toLowerCase().replace(/[^a-z0-9_]+/g, "_")}`;

/* ── preflight: what the referenced key may do ──────────────────────────── */

/*
  Scopes are what the check can see from the key, by provider. Hosted voice
  platforms that clone an assistant need create scope; a read-only key still
  works, on the exported definition.
*/
const SCOPES = {
  vapi: ["read assistants", "create assistants"],
  bland: ["read agents", "create agents"],
  retell: ["read agents"],
  elevenlabs: ["read agents"],
  livekit: ["join rooms", "publish audio"],
  deepgram: ["streaming speech to text"],
  openai: ["chat completions", "realtime"],
  "vertex-ai": ["generate content"],
  "future-agi": ["write traces", "upload recordings"],
  customer: ["call the chat endpoint"],
};

/** Which provider a key belongs to, from its name or its manifest entry. */
export const providerOfKey = (key, fallback) => {
  const k = String(key || "").toLowerCase();
  const hit = Object.keys(SCOPES).find((p) => k.startsWith(`${p}_`) || k.startsWith(p.replace(/-/g, "_")));
  return hit || fallback || null;
};

const joinScopes = (scopes) => (scopes.length > 1 ? `${scopes.slice(0, -1).join(", ")} + ${scopes[scopes.length - 1]}` : scopes[0] || "no scopes");

/**
 * The access check for one reference. Deterministic in the reference so a
 * demo re-check lands the same way: a path naming a revoked or missing
 * secret fails; a read-only key passes with read scope only.
 */
export const preflightAccess = ({ ref, provider }) => {
  if (!isSecretRef(ref)) return { ok: false, line: "Not a reference", scopes: [] };
  if (/(revoked|missing|deleted)/i.test(ref)) {
    return { ok: false, scopes: [], line: `No secret at that path in ${storeOfRef(ref)?.label || "the secret manager"}` };
  }
  const all = SCOPES[provider] || ["read"];
  const readOnly = keyLacksCreateScope(ref) || /readonly/i.test(ref);
  const scopes = readOnly ? all.filter((s) => !/^create|^publish|^write|^upload/.test(s)) : all;
  const kept = scopes.length ? scopes : all.slice(0, 1);
  return {
    ok: true,
    scopes: kept,
    line: joinScopes(kept),
    note: readOnly && kept.length < all.length ? "No create scope — a clone can't be made; runs use the exported definition (mocked)." : null,
  };
};

/** How long the check takes on screen. */
export const PREFLIGHT_MS = 1100;

/** The record a finished check leaves on envState.secretChecks. */
export const preflightRecord = (ref, provider) => ({ ref, provider: provider || null, at: new Date().toISOString(), ...preflightAccess({ ref, provider }) });

/* ── migrating stored values ────────────────────────────────────────────── */

/*
  A secret env var stored with a raw-looking `value` becomes a reference to
  where the workspace keeps it. Non-secret vars keep their values.
*/
export const toRefVar = (row) => {
  if (!row?.secret) return row;
  if (row.ref && isSecretRef(row.ref)) {
    if (row.value === undefined) return row;
    const { value, ...rest } = row;
    return rest;
  }
  const { value, ...rest } = row;
  return { ...rest, ref: isSecretRef(value) ? value.trim() : defaultRefFor(row.key), ...(value && !isSecretRef(value) && { migrated: true }) };
};

export const migrateEnvVars = (list) => (Array.isArray(list) ? list.map(toRefVar) : list);

/*
  An agent connected with a pasted API key kept it in its values. The key is
  replaced by a reference to the provider's slot in the workspace vault; the
  agent still reads as having a key.
*/
export const scrubAgentSecrets = (agent) => {
  const v = agent?.values;
  if (!v || v.apiKey === undefined) return agent;
  const { apiKey, ...rest } = v;
  if (!apiKey) return { ...agent, values: rest };
  const ref = isSecretRef(apiKey) ? apiKey.trim() : defaultRefFor(`${v.provider || "agent"}_api_key`);
  return {
    ...agent,
    values: { ...rest, hasApiKey: true, apiKeyRef: ref, ...(!isSecretRef(apiKey) && { apiKeyMigrated: true }) },
  };
};

/** Patch helpers, so the panels and the chat write the same shape. */
export const credentialRefPatch = (envState, id, ref, provider) => ({
  credentialRefs: { ...(envState?.credentialRefs || {}), [id]: ref },
  secretChecks: { ...(envState?.secretChecks || {}), [id]: preflightRecord(ref, provider) },
});

/*
  Connection values filled from somewhere that carries the secret itself — a
  pasted curl holds the bearer token. Anything in a secret slot that isn't a
  reference is left out, so the form only ever holds references.
    → { values, dropped: ["token"] }
*/
export const SECRET_VALUE_KEYS = ["token", "apiKey", "authToken", "password"];
export const withoutRawSecrets = (values, keys = SECRET_VALUE_KEYS) => {
  if (!values) return { values, dropped: [] };
  const dropped = keys.filter((k) => values[k] != null && values[k] !== "" && !isSecretRef(values[k]));
  if (!dropped.length) return { values, dropped };
  const kept = { ...values };
  dropped.forEach((k) => { delete kept[k]; });
  return { values: kept, dropped };
};
