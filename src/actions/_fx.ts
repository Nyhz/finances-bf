import "server-only";
import { and, desc, eq, lte } from "drizzle-orm";
import type { db as dbModule, DB } from "../db/client";
import { fxRates } from "../db/schema";
import {
  resolveFxRateSync,
  type FxLookupSync,
  type FxRateResult,
} from "../lib/fx";

type Tx = Parameters<Parameters<(typeof dbModule)["transaction"]>[0]>[0];
type DbOrTx = DB | Tx;

/** `fx_rates`-backed synchronous lookup for use inside server actions. */
export function dbFxLookup(tx: DbOrTx): FxLookupSync {
  return {
    findOnDate: (currency, isoDate) => {
      const row = tx
        .select()
        .from(fxRates)
        .where(and(eq(fxRates.currency, currency), eq(fxRates.date, isoDate)))
        .get();
      return row
        ? { currency: row.currency, date: row.date, rateToEur: row.rateToEur }
        : null;
    },
    findLatest: (currency, onOrBefore) => {
      const row = tx
        .select()
        .from(fxRates)
        .where(
          onOrBefore
            ? and(eq(fxRates.currency, currency), lte(fxRates.date, onOrBefore))
            : eq(fxRates.currency, currency),
        )
        .orderBy(desc(fxRates.date))
        .get();
      return row
        ? { currency: row.currency, date: row.date, rateToEur: row.rateToEur }
        : null;
    },
  };
}

/** A manual rate this far off the stored daily rate is almost certainly a typo
 *  or the inverse pair (EUR→CCY instead of CCY→EUR). */
export const FX_DEVIATION_TOLERANCE = 0.2;

export class FxDeviationError extends Error {
  readonly currency: string;
  readonly isoDate: string;
  readonly explicitRate: number;
  readonly storedRate: number;
  readonly storedDate: string;
  constructor(
    currency: string,
    isoDate: string,
    explicitRate: number,
    storedRate: number,
    storedDate: string,
  ) {
    const looksInverted = Math.abs(explicitRate * storedRate - 1) < 0.02;
    super(
      `Manual rate ${explicitRate} is far from the stored ${currency}→EUR rate ` +
        `${storedRate} (${storedDate}).` +
        (looksInverted
          ? ` It looks like the inverse (EUR→${currency}) rate — did you mean ${Number((1 / explicitRate).toFixed(6))}?`
          : " Double-check it, or confirm to use your rate anyway."),
    );
    this.name = "FxDeviationError";
    this.currency = currency;
    this.isoDate = isoDate;
    this.explicitRate = explicitRate;
    this.storedRate = storedRate;
    this.storedDate = storedDate;
  }
}

/**
 * The one sanctioned way for a server action to turn (currency, date) into an
 * FX rate (CLAUDE.md: FX resolution goes through `src/lib/fx.ts`, never
 * ad-hoc). Returns the full resolution — callers must persist `source` (and
 * surface `stale`) on the row they stamp, so a tax-relevant EUR amount always
 * carries the provenance of the rate that produced it.
 *
 * Throws `FxUnavailableError` when no rate exists at all — actions map that
 * to a validation error asking for a manual rate. Throws `FxDeviationError`
 * when an explicit rate strays beyond FX_DEVIATION_TOLERANCE from the stored
 * rate for that date, unless `allowDeviation` is set (fat-finger guard).
 */
export function resolveFxForDate(
  tx: DbOrTx,
  currency: string,
  isoDate: string,
  explicitRate?: number | null,
  opts?: { allowDeviation?: boolean },
): FxRateResult {
  const lookup = dbFxLookup(tx);
  const ccy = currency.toUpperCase();
  if (explicitRate != null && Number.isFinite(explicitRate) && explicitRate > 0 && ccy !== "EUR" && !opts?.allowDeviation) {
    const stored = lookup.findOnDate(ccy, isoDate) ?? lookup.findLatest(ccy, isoDate);
    if (stored) {
      const ratio = explicitRate / stored.rateToEur;
      // Near-parity pairs (USD, CHF) make the inverse rate fall INSIDE the
      // generic tolerance, so the inverse is detected on its own: the product
      // of a rate and its inverse is ~1 while the rate itself differs.
      const looksInverted =
        Math.abs(explicitRate * stored.rateToEur - 1) < 0.02 && Math.abs(ratio - 1) > 0.02;
      if (looksInverted || Math.abs(ratio - 1) > FX_DEVIATION_TOLERANCE) {
        throw new FxDeviationError(ccy, isoDate, explicitRate, stored.rateToEur, stored.date);
      }
    }
  }
  return resolveFxRateSync(currency, isoDate, lookup, { explicitRate });
}
