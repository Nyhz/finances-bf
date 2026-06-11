import "server-only";
import { and, desc, eq, lte } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { fxRates } from "../db/schema";
import type { FxLookupSync, FxRateResult } from "../lib/fx";


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
 *  or the inverse pair (CCY→EUR instead of EUR→CCY). */
export const FX_DEVIATION_TOLERANCE = 0.2;

export class FxDeviationError extends Error {
  readonly currency: string;
  readonly isoDate: string;
  /** What the user typed, in EUR→CCY terms (1 EUR = X CCY). */
  readonly enteredEurToCcy: number;
  /** Daily reference, in EUR→CCY terms. */
  readonly storedEurToCcy: number;
  readonly storedDate: string;
  constructor(
    currency: string,
    isoDate: string,
    enteredEurToCcy: number,
    storedEurToCcy: number,
    storedDate: string,
  ) {
    const looksInverted = Math.abs(enteredEurToCcy / storedEurToCcy - 1) > 0.02 &&
      Math.abs(enteredEurToCcy * storedEurToCcy - 1) < 0.02;
    super(
      `El tipo manual 1 EUR = ${enteredEurToCcy} ${currency} se aleja de la referencia diaria ` +
        `1 EUR = ${Number(storedEurToCcy.toFixed(6))} ${currency} (${storedDate}).` +
        (looksInverted
          ? ` Parece el tipo inverso (${currency}→EUR) — ¿querías decir ${Number((1 / enteredEurToCcy).toFixed(6))}?`
          : " Revísalo, o confirma para usar tu tipo igualmente."),
    );
    this.name = "FxDeviationError";
    this.currency = currency;
    this.isoDate = isoDate;
    this.enteredEurToCcy = enteredEurToCcy;
    this.storedEurToCcy = storedEurToCcy;
    this.storedDate = storedDate;
  }
}

/** A non-EUR money entry arrived without a manual FX rate. There is no
 *  fallback by design — the broker's rate is always typed by hand. */
export class FxManualRequiredError extends Error {
  readonly currency: string;
  readonly isoDate: string;
  constructor(currency: string, isoDate: string) {
    super(
      `Falta el tipo de cambio: introduce el tipo 1 EUR = ? ${currency} de tu broker para ${isoDate}. ` +
        `Los tipos diarios almacenados nunca se aplican a transacciones.`,
    );
    this.name = "FxManualRequiredError";
    this.currency = currency;
    this.isoDate = isoDate;
  }
}

/**
 * The one sanctioned way for a money-entry action to obtain an FX rate.
 *
 * The user ALWAYS types the rate, in the broker's direction (DEGIRO shows
 * EUR→CCY: 1 EUR = 1.15 USD) — `eurToCcy`. Internally everything stays in
 * the storage convention (rateToEur = EUR per 1 CCY), so the inversion
 * happens exactly once, here. Stored daily `fx_rates` are NEVER applied to a
 * transaction: they act purely as a fat-finger guard (±20%, inverse-pair
 * detection), skippable with `allowDeviation` after explicit confirmation.
 *
 * Throws `FxManualRequiredError` when a non-EUR entry has no rate, and
 * `FxDeviationError` when the typed rate fails the guard.
 */
export function requireManualFx(
  tx: DbOrTx,
  currency: string,
  isoDate: string,
  eurToCcy: number | null | undefined,
  opts?: { allowDeviation?: boolean },
): FxRateResult {
  const ccy = currency.toUpperCase();
  if (ccy === "EUR") return { rate: 1, source: "unit" };
  if (eurToCcy == null || !Number.isFinite(eurToCcy) || eurToCcy <= 0) {
    throw new FxManualRequiredError(ccy, isoDate);
  }
  const rate = 1 / eurToCcy; // storage convention: EUR per 1 CCY

  if (!opts?.allowDeviation) {
    const lookup = dbFxLookup(tx);
    const stored = lookup.findOnDate(ccy, isoDate) ?? lookup.findLatest(ccy, isoDate);
    if (stored) {
      const storedEurToCcy = 1 / stored.rateToEur;
      const ratio = eurToCcy / storedEurToCcy;
      // Near-parity pairs (USD, CHF) make the inverse rate fall INSIDE the
      // generic tolerance, so the inverse is detected on its own: the product
      // of a rate and its inverse is ~1 while the rate itself differs.
      const looksInverted =
        Math.abs(eurToCcy * storedEurToCcy - 1) < 0.02 && Math.abs(ratio - 1) > 0.02;
      if (looksInverted || Math.abs(ratio - 1) > FX_DEVIATION_TOLERANCE) {
        throw new FxDeviationError(ccy, isoDate, eurToCcy, storedEurToCcy, stored.date);
      }
    }
  }
  return { rate, source: "explicit" };
}
