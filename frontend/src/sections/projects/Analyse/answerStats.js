// How traces with each answer behave compared with every other answered trace
// in the same run. A difference is only called out when it is both large
// enough to matter and unlikely to be chance after correcting for the number
// of comparisons (Benjamini-Hochberg across every test in the question).

const MIN_GROUP = 5;
const ALPHA = 0.05;
const LATENCY_RATIO = 1.25;
const ERROR_POINTS = 0.05;

const isError = (status) => `${status || ""}`.toUpperCase() === "ERROR";

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const mean = (values) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

// Abramowitz-Stegun 7.1.26; plenty for a p-value threshold.
function normalCdf(z) {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

const twoSided = (z) => 2 * (1 - normalCdf(Math.abs(z)));

// Two-proportion z-test with a pooled rate.
export function proportionTest(hitsA, nA, hitsB, nB) {
  if (nA < 1 || nB < 1) return 1;
  const pooled = (hitsA + hitsB) / (nA + nB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  if (!se) return 1;
  return twoSided((hitsA / nA - hitsB / nB) / se);
}

// Mann-Whitney U with the normal approximation and average ranks for ties.
export function rankTest(a, b) {
  if (a.length < 2 || b.length < 2) return 1;
  const all = [
    ...a.map((value) => ({ value, group: 0 })),
    ...b.map((value) => ({ value, group: 1 })),
  ].sort((x, y) => x.value - y.value);
  const ranks = new Array(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].value === all[i].value) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[k] = rank;
    const ties = j - i + 1;
    tieTerm += ties ** 3 - ties;
    i = j + 1;
  }
  const rankSumA = all.reduce(
    (sum, entry, index) => sum + (entry.group === 0 ? ranks[index] : 0),
    0,
  );
  const nA = a.length;
  const nB = b.length;
  const u = rankSumA - (nA * (nA + 1)) / 2;
  const n = nA + nB;
  const variance = ((nA * nB) / 12) * (n + 1 - tieTerm / (n * (n - 1)));
  if (variance <= 0) return 1;
  return twoSided((u - (nA * nB) / 2) / Math.sqrt(variance));
}

// Benjamini-Hochberg adjusted p-values, in input order.
export function adjustPValues(pValues) {
  const order = pValues
    .map((p, index) => ({ p, index }))
    .sort((a, b) => a.p - b.p);
  const adjusted = new Array(pValues.length);
  let running = 1;
  for (let rank = order.length; rank >= 1; rank -= 1) {
    const { p, index } = order[rank - 1];
    running = Math.min(running, (p * order.length) / rank);
    adjusted[index] = running;
  }
  return adjusted;
}

export function computeAnswerStats(traces, item) {
  const answered = traces.filter((trace) => {
    const answer = trace.answers?.[item.configId];
    return answer !== undefined && answer !== "error";
  });
  const rows = item.labels.map((label) => {
    const inGroup = answered.filter(
      (trace) => trace.answers[item.configId] === label,
    );
    const rest = answered.filter(
      (trace) => trace.answers[item.configId] !== label,
    );
    const latency = (list) =>
      list.map((trace) => trace.latency).filter((value) => value != null);
    const groupLatency = latency(inGroup);
    const restLatency = latency(rest);
    const groupErrors = inGroup.filter((trace) => isError(trace.status)).length;
    const restErrors = rest.filter((trace) => isError(trace.status)).length;
    const costs = inGroup
      .map((trace) => trace.cost)
      .filter((value) => value != null);
    return {
      label,
      count: inGroup.length,
      share: answered.length ? inGroup.length / answered.length : 0,
      latency: median(groupLatency),
      restLatency: median(restLatency),
      latencyP:
        groupLatency.length >= MIN_GROUP && restLatency.length >= MIN_GROUP
          ? rankTest(groupLatency, restLatency)
          : null,
      errorRate: inGroup.length ? groupErrors / inGroup.length : null,
      restErrorRate: rest.length ? restErrors / rest.length : null,
      errorP:
        inGroup.length >= MIN_GROUP &&
        rest.length >= MIN_GROUP &&
        groupErrors + restErrors > 0
          ? proportionTest(groupErrors, inGroup.length, restErrors, rest.length)
          : null,
      cost: mean(costs),
    };
  });

  const tests = [];
  rows.forEach((row, index) => {
    if (row.latencyP != null)
      tests.push({ index, key: "latency", p: row.latencyP });
    if (row.errorP != null) tests.push({ index, key: "error", p: row.errorP });
  });
  const adjusted = adjustPValues(tests.map((test) => test.p));
  tests.forEach((test, i) => {
    const row = rows[test.index];
    const significant = adjusted[i] < ALPHA;
    if (test.key === "latency") {
      const ratio =
        row.latency && row.restLatency ? row.latency / row.restLatency : 1;
      row.latencyRatio = ratio;
      row.latencyNotable =
        significant && (ratio >= LATENCY_RATIO || ratio <= 1 / LATENCY_RATIO);
    } else {
      row.errorNotable =
        significant &&
        Math.abs((row.errorRate || 0) - (row.restErrorRate || 0)) >=
          ERROR_POINTS;
    }
  });

  return {
    answered: answered.length,
    rows,
    hasLatency: rows.some((row) => row.latency != null),
    hasErrors: answered.some((trace) => isError(trace.status)),
    hasCost: rows.some((row) => row.cost),
  };
}
