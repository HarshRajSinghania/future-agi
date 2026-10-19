/* Shared by the runs tables. */
import { creditsForUsd } from "../_mock/metering";

/* A spend (list-price dollars underneath) said in credits. Per-call amounts
   are a few credits, so small ones keep one decimal. */
const CREDITS_PER_USD = creditsForUsd(1);
export const creditsText = (usd) => {
  if (usd == null || Number.isNaN(Number(usd))) return "—";
  const c = Number(usd) * CREDITS_PER_USD;
  return `${c >= 10 || c === 0 ? Math.round(c).toLocaleString() : c.toFixed(1)} credits`;
};

/* 294,000 → 294K: the column is read for magnitude, and the full figure
   was the widest thing in the row. */
export const compactTokens = (n) => {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(v);
};
