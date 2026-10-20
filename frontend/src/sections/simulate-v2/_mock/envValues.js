import { isSecretRef, looksLikeRawKey } from "./secretRefs";

/*
  Environment values for a code agent — the test credentials and settings
  our sandbox runs its code with (as in the product's repo and upload
  panels: pasted .env contents and a credential file). Test credentials
  only, never a production key. Secrets go in as references into the team's
  secret manager; the value is resolved inside the sandbox and is never
  stored, logged or written to a run. Plain settings keep their value.

  No egress domains: the sandbox has no route out, and a tool that would
  reach outside is stubbed (sandbox.js) — that's what keeps a run sealed.
*/

/* A name that holds a secret, whatever its value looks like. */
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|CREDENTIAL|PRIVATE|AUTH|DSN|DATABASE_URL|CONN)/i;
export const isSecretName = (name) => SECRET_NAME.test(String(name || ""));

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse pasted .env contents. Comments and blank lines are skipped, `export`
 * and surrounding quotes are dropped. A secret given as anything but a
 * reference is refused — its name is kept so the person can add where it's
 * held.
 */
export function parseEnvText(text) {
  const values = [];
  const refused = [];
  const invalid = [];
  String(text || "").split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = line.replace(/^export\s+/, "").match(/^([^=\s]+)\s*=\s*(.*)$/);
    if (!m || !NAME_RE.test(m[1])) { invalid.push(line.slice(0, 40)); return; }
    const name = m[1];
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2").trim();
    const secret = isSecretName(name) || looksLikeRawKey(value);
    if (secret) {
      if (isSecretRef(value)) values.push({ name, secret: true, ref: value });
      else refused.push(name);
    } else {
      values.push({ name, secret: false, value });
    }
  });
  return { values, refused, invalid };
}

/** Merge parsed values into a list, later names replacing earlier ones. */
export const mergeEnvValues = (list, more) => {
  const byName = new Map((list || []).map((v) => [v.name, v]));
  (more || []).forEach((v) => byName.set(v.name, v));
  return [...byName.values()];
};

/* An uploaded credential file is stored by us and mounted per run; the
   record keeps only where it's held. */
export const credentialFileRefOf = (fileName) =>
  `vault://acme/sim/files/${String(fileName || "credentials.json").toLowerCase().replace(/[^a-z0-9._-]+/g, "_")}`;

/** What a connect form adds to the agent's source. */
export const envValuesSourceOf = ({ values = [], files = [] }) => ({
  ...(values.length && { envValues: values.map((v) => (v.secret ? { name: v.name, secret: true, ref: v.ref } : { name: v.name, value: v.value })) }),
  ...(files.length && { credentialFiles: files.map((f) => ({ name: f.name, ref: f.ref })) }),
});
