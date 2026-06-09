/**
 * Nominal (branded) EUR types — the compile-time wall between user-entered
 * money and market-derived money (audit T8).
 *
 * `TxEur` marks amounts that trace to user/broker-entered transaction data
 * (the only thing allowed to feed realized gains and dividends). `MarketEur`
 * marks amounts derived from market quotes (valuations, M720 year-end
 * values). Both are plain `number`s at runtime; the brand only exists for
 * the compiler, so passing a `MarketEur` where a `TxEur` is expected is a
 * type error — while either still flows into display helpers that take
 * `number`.
 *
 * Constructors live at the DB read boundary (`src/server/`): brand a value
 * exactly where its provenance is known, never deeper in the call stack.
 */

declare const TX_EUR: unique symbol;
declare const MARKET_EUR: unique symbol;

export type TxEur = number & { readonly [TX_EUR]: true };
export type MarketEur = number & { readonly [MARKET_EUR]: true };

/** Brand a user/broker-entered EUR amount (transaction-sourced). */
export function txEur(n: number): TxEur {
  return n as TxEur;
}

/** Brand a market-quote-derived EUR amount (valuation-sourced). */
export function marketEur(n: number): MarketEur {
  return n as MarketEur;
}

/** Explicitly drop the brand (rarely needed — `number` parameters accept branded values as-is). */
export function unbrand(n: TxEur | MarketEur): number {
  return n;
}
