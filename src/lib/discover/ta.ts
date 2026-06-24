// Pure technical-analysis helpers over a date-ascending array of daily closes.
// These power the deterministic verification of the Discover agent's candidates —
// the agent proposes tickers, these turn real price history into hard numbers.
// No repo equivalents existed (risk.ts works on a performance index, not raw
// price bars), so they live here, fully unit-tested on synthetic series.

import { round } from "../money";

/** Simple moving average of the last `n` closes. Null if fewer than `n` points. */
export function sma(closes: number[], n: number): number | null {
  if (n <= 0 || closes.length < n) return null;
  const window = closes.slice(-n);
  const sum = window.reduce((a, b) => a + b, 0);
  return round(sum / n, 6);
}

/** Highest close over the last `n` sessions (or all of them if `n` >= length). */
export function rollingMax(closes: number[], n: number): number | null {
  if (closes.length === 0) return null;
  const window = closes.slice(-Math.min(n, closes.length));
  return Math.max(...window);
}

/** Fractional change between two prices: (to - from) / from. */
export function pctChange(from: number, to: number): number {
  if (from === 0) return 0;
  return round((to - from) / from, 6);
}

/** Return over the last `n` sessions: change from the close `n` sessions ago to
 *  the latest close. Null if there aren't `n`+1 points. */
export function momentum(closes: number[], n: number): number | null {
  if (closes.length < n + 1) return null;
  const from = closes[closes.length - 1 - n];
  const to = closes[closes.length - 1];
  return pctChange(from, to);
}

/** How far the latest close sits below its 52-week (≈252 sessions) high, as a
 *  non-positive fraction (0 at a fresh high, negative below). Null if empty. */
export function pctBelow52wHigh(closes: number[]): number | null {
  if (closes.length === 0) return null;
  const high = rollingMax(closes, 252);
  if (high == null || high === 0) return null;
  const last = closes[closes.length - 1];
  return pctChange(high, last);
}
