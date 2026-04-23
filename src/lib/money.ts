// Half-up 2-decimal rounding for EUR amounts. `Number.EPSILON` avoids the
// `0.1 + 0.2 = 0.30000…4` class of float drifts that would otherwise bite
// when summed across thousands of rows.
export function roundEur(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Generic N-decimal rounding. Replaces the ad-hoc `round(n, dp=6)` helpers
// that existed in `server/recompute.ts`, `server/valuations.ts`,
// `lib/fx-backfill.ts` and `lib/price-sync.ts`. Default 6 dp matches the
// original behaviour of those helpers.
export function round(n: number, decimals: number = 6): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

