/*
  Customer Support Line, five scenarios a goal.

  The demo suite had 70 scenarios over 25 goals — two to four each, one for
  some — so grouped by goal the table read as a list of one-row sections.
  Each goal is topped up to five with the same task under a different kind
  of caller: the variations a team writes once the first draft of a suite
  holds up.

  The new scenarios are appended to every stored run's scenario list, at the
  end, so the scenarios already there keep the outcomes they had and the new
  ones get a history of their own. Added once.
*/

export const TOPUP_ENV = "env-voice-support";
const TARGET = 5;

const VARIANTS = [
  { slug: "rushed", summary: "In a rush, wants it done in one call", detail: "The caller is short on time and pushes to skip steps." },
  { slug: "noisy-line", summary: "Calls from a noisy street, repeats details", detail: "Background noise means details come through in pieces." },
  { slug: "second-language", summary: "Second-language caller, keeps it simple", detail: "The caller uses simple words and sometimes the wrong term." },
  { slug: "repeat-please", summary: "Needs key details repeated slowly", detail: "The caller asks for the important details to be repeated." },
  { slug: "after-bad-call", summary: "Annoyed after a previous call went badly", detail: "The caller opens frustrated about an earlier call." },
  { slug: "vague", summary: "Vague at first, details come out slowly", detail: "The caller only gives details when they're asked for." },
  { slug: "on-behalf", summary: "Calling on behalf of a family member", detail: "The caller is acting for someone else on the account." },
  { slug: "changes-mind", summary: "Changes their mind halfway through", detail: "The caller switches what they want partway through." },
];

const PERSONAS = [
  { name: "Maria Gonzalez", gender: "female", ageGroup: "40-50" },
  { name: "Kenji Watanabe", gender: "male", ageGroup: "30-40" },
  { name: "Fatima Al-Sayed", gender: "female", ageGroup: "20-30" },
  { name: "Tom Becker", gender: "male", ageGroup: "60-70" },
  { name: "Grace Okafor", gender: "female", ageGroup: "30-40" },
  { name: "Luca Bianchi", gender: "male", ageGroup: "20-30" },
  { name: "Ananya Iyer", gender: "female", ageGroup: "40-50" },
  { name: "Daniel Kim", gender: "male", ageGroup: "50-60" },
  { name: "Sofia Novak", gender: "female", ageGroup: "30-40" },
  { name: "Omar Haddad", gender: "male", ageGroup: "40-50" },
  { name: "Chloe Martin", gender: "female", ageGroup: "20-30" },
  { name: "Rafael Souza", gender: "male", ageGroup: "50-60" },
];

const isCanary = (sc) => !!sc.canary || /^canary/i.test(sc.useCase || "");

/** The environment's state with every goal at five scenarios or more. */
export const withFiveAGoal = (env, es) => {
  const scenarios = es?.scenarios || [];
  if (!scenarios.length || scenarios.some((sc) => sc.seededAs === "topup")) return es;
  const byGoal = new Map();
  scenarios.filter((sc) => !sc.retired && !isCanary(sc)).forEach((sc) => {
    const k = sc.useCase || "Other";
    byGoal.set(k, [...(byGoal.get(k) || []), sc]);
  });

  const added = [];
  let p = 0;
  [...byGoal.entries()].forEach(([, rows], gi) => {
    const taken = new Set(rows.map((r) => r.summary));
    const options = VARIANTS.filter((v) => !taken.has(v.summary));
    for (let k = 0; rows.length + k < TARGET; k += 1) {
      const tpl = rows[k % rows.length];
      const v = options[(gi + k) % options.length];
      const who = PERSONAS[p % PERSONAS.length];
      p += 1;
      const { id: _pid, libraryId: _lib, edited: _ed, ...persona } = tpl.persona || {};
      added.push({
        ...tpl,
        id: `${tpl.id}-${v.slug}`,
        name: `${String(tpl.name || tpl.id).replace(/-[a-z]+$/, "")}-${v.slug}`,
        summary: v.summary,
        situation: [tpl.situation || tpl.task, v.detail].filter(Boolean).join(" "),
        task: [tpl.task, v.detail].filter(Boolean).join(" "),
        persona: { ...persona, ...who },
        /* Must-pass stays with the scenarios someone chose. */
        critical: false,
        tier: "core",
        seededAs: "topup",
      });
    }
  });
  if (!added.length) return es;

  const ids = added.map((sc) => sc.id);
  const runs = (es.runs || []).map((r) => (r.scenarioIds?.length ? { ...r, scenarioIds: [...r.scenarioIds, ...ids], total: r.scenarioIds.length + ids.length } : r));
  return { ...es, scenarios: [...scenarios, ...added], runs };
};
