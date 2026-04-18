import YahooFinance from "yahoo-finance2";
import { toIsoDate } from "../fx";
import type { HistoricalBar, Quote } from "./types";

const yahooFinance = new YahooFinance();

export async function fetchQuote(symbol: string): Promise<Quote> {
  const raw = (await yahooFinance.quote(symbol)) as {
    regularMarketPrice?: number;
    currency?: string;
    regularMarketTime?: Date | number;
  };
  const price = raw.regularMarketPrice;
  if (price == null || !Number.isFinite(price)) {
    throw new Error(`fetchQuote: no regularMarketPrice for ${symbol}`);
  }
  const currency = (raw.currency ?? "USD").toUpperCase();
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
  const rows = (await yahooFinance.historical(symbol, {
    period1: from,
    period2: to,
    interval: "1d",
  })) as Array<{ date: Date; close: number | null }>;
  const currency = "USD";
  return rows
    .filter((r): r is { date: Date; close: number } => r.close != null)
    .map((r) => ({
      date: toIsoDate(r.date),
      close: r.close,
      currency,
    }));
}
