/*
  Environment names stay tellable apart. A new environment whose name is
  already taken gets the next number — "Billing support environment 2", "… 3"
  — the way a file copy does. Only names given at creation are numbered; a
  rename is the user's own choice and is kept as typed.
*/
export const uniqueEnvName = (name, envs = [], selfId = null) => {
  const base = String(name || "").trim();
  if (!base) return base;
  const taken = new Set(envs.filter((e) => e.id !== selfId).map((e) => String(e.name || "").trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  /* "Name 3" counts on from 3, not from "Name 3 2". */
  const m = /^(.*?)\s+(\d+)$/.exec(base);
  const stem = m ? m[1] : base;
  let n = m ? Number(m[2]) + 1 : 2;
  while (taken.has(`${stem} ${n}`.toLowerCase())) n += 1;
  return `${stem} ${n}`;
};
