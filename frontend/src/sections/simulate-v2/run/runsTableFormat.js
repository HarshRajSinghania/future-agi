/* Shared by the runs tables. */

/* 294,000 → 294K: the column is read for magnitude, and the full figure
   was the widest thing in the row. */
export const compactTokens = (n) => {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(v);
};
