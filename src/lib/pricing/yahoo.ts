import YahooFinance from "yahoo-finance2";
import { toIsoDate } from "../fx";
import { withTimeout } from "./_net";
import type { HistoricalBar, Quote } from "./types";

const yahooFinance = new YahooFinance();

export async function fetchQuote(symbol: string): Promise<Quote> {
  const raw = (await withTimeout(
    yahooFinance.quote(symbol),
    undefined,
    `yahoo quote ${symbol}`,
  )) as {
    regularMarketPrice?: number;
    currency?: string;
    regularMarketTime?: Date | number;
  };
  const price = raw.regularMarketPrice;
  if (price == null || !Number.isFinite(price)) {
    throw new Error(`fetchQuote: no regularMarketPrice for ${symbol}`);
  }
  // Audit R2: never guess the quote currency. A silent "USD" default would
  // convert with the wrong FX and corrupt valuations.
  if (!raw.currency || !/^[A-Za-z]{3}$/.test(raw.currency)) {
    throw new Error(
      `fetchQuote: Yahoo returned no usable currency for ${symbol} (got ${JSON.stringify(raw.currency)})`,
    );
  }
  const currency = raw.currency.toUpperCase();
  const asOfRaw = raw.regularMarketTime;
  const asOf =
    asOfRaw instanceof Date
      ? asOfRaw
      : typeof asOfRaw === "number"
        ? new Date(asOfRaw * 1000)
        : new Date();
  return { symbol, price, currency, asOf };
}

export async function fetchHistory(
  symbol: string,
  from: Date,
  to: Date,
): Promise<HistoricalBar[]> {
  const rows = (await withTimeout(
    yahooFinance.historical(symbol, {
      period1: from,
      period2: to,
      interval: "1d",
    }),
    undefined,
    `yahoo historical ${symbol}`,
  )) as Array<{ date: Date; close: number | null }>;
  // NOTE: Yahoo's historical endpoint does not return a per-row currency.
  // The "USD" below is a placeholder — no live code path consumes this field
  // (crypto backfills use the CoinGecko client, which is EUR-native). Anyone
  // wiring this into a calculation must fetch the real currency via quote().
  const currency = "USD";
  return rows
    .filter((r): r is { date: Date; close: number } => r.close != null)
    .map((r) => ({
      date: toIsoDate(r.date),
      close: r.close,
      currency,
    }));
}
