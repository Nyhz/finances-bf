export type FxSource = "unit" | "explicit" | "historical" | "latest";

export type FxRateResult = {
  rate: number;
  source: FxSource;
  /** True when the rate had to fall back to the most recent known rate instead of the requested date. */
  stale?: boolean;
};

export type FxRateRow = {
  currency: string;
  date: string; // ISO yyyy-MM-dd
  rateToEur: number;
};

/**
 * Caller provides the lookup. This keeps `fx.ts` decoupled from a live Drizzle db —
 * tests pass a stub; server code passes a db-backed function.
 */
export type FxLookup = {
  /** Rate for an exact date, or null if none. */
  findOnDate: (currency: string, isoDate: string) => Promise<FxRateRow | null>;
  /** Most recent rate on or before the given date, or null if none. */
  findLatest: (currency: string, onOrBefore?: string) => Promise<FxRateRow | null>;
};

export type ResolveFxOptions = {
  /** Explicit override (e.g. snapshotted on the originating transaction) — wins over lookup. */
  explicitRate?: number | null;
};

import { toIsoDate } from "./time";
// Re-exported for the many callers already importing from `./fx`. New code
// should import from `./time` directly.
export { toIsoDate };

export async function resolveFxRate(
  currency: string,
  date: Date | string,
  lookup: FxLookup,
  options: ResolveFxOptions = {},
): Promise<FxRateResult> {
  const ccy = currency.toUpperCase();
  if (ccy === "EUR") {
    return { rate: 1, source: "unit" };
  }

  if (options.explicitRate != null && Number.isFinite(options.explicitRate)) {
    if (options.explicitRate <= 0) {
      throw new Error(`resolveFxRate: explicit rate must be positive (got ${options.explicitRate})`);
    }
    return { rate: options.explicitRate, source: "explicit" };
  }

  const iso = toIsoDate(date);
  const onDate = await lookup.findOnDate(ccy, iso);
  if (onDate) {
    return { rate: onDate.rateToEur, source: "historical" };
  }

  const latest = await lookup.findLatest(ccy, iso);
  if (latest) {
    return { rate: latest.rateToEur, source: "latest", stale: true };
  }

  throw new Error(`resolveFxRate: no FX rate available for ${ccy} on ${iso}`);
}
