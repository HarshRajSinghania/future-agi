// The executive summary cites examples as "#n" ("... (#3, #11)."). The report
// carries the map from n to the unit it means; these helpers turn the text
// into segments so each citation renders as a clickable chip.

// A parenthesised run of citations "(#3, #11)" or "(#1 and #2)", or a lone "#7".
const CITATION = /\(\s*#\d+(?:\s*(?:,|;|and|&)\s*#\d+)*\s*\)|#\d+/g;

/**
 * Map every citable number to {unitId, categoryId} from summary.examples,
 * summary.key_points[].refs and summary.highlights.
 */
export function buildRefIndex(summary) {
  const index = new Map();
  const add = (ref, unitId, categoryId) => {
    const n = Number(ref);
    if (!Number.isInteger(n) || !unitId) return;
    const known = index.get(n) || {};
    index.set(n, {
      unitId: known.unitId || unitId,
      categoryId: known.categoryId || categoryId || "",
    });
  };
  (summary?.examples || []).forEach((e) =>
    add(e.ref, e.unit_id, e.category_id),
  );
  (summary?.key_points || []).forEach((point) =>
    (point.refs || []).forEach((r) => add(r.ref, r.unit_id)),
  );
  (summary?.highlights || []).forEach((h) =>
    add(h.ref, h.unit_id, h.category_id),
  );
  return index;
}

/**
 * Split text into [{type: "text", text}] and [{type: "refs", refs: [n, ...]}]
 * segments. A citation whose numbers are not all known stays plain text, so a
 * stray "#2" in prose never becomes a dead chip.
 */
export function parseCitations(text, refIndex) {
  const source = String(text || "");
  const segments = [];
  let last = 0;
  const pushText = (value) => {
    if (!value) return;
    const previous = segments[segments.length - 1];
    if (previous?.type === "text") previous.text += value;
    else segments.push({ type: "text", text: value });
  };
  for (const match of source.matchAll(CITATION)) {
    const refs = [...match[0].matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
    const known = refs.every((n) => !refIndex || refIndex.has(n));
    pushText(source.slice(last, match.index));
    if (known) segments.push({ type: "refs", refs });
    else pushText(match[0]);
    last = match.index + match[0].length;
  }
  pushText(source.slice(last));
  return segments;
}
