import YahooFinance from "yahoo-finance2";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { db as dbModule, DB } from "../db/client";
import { fxRates } from "../db/schema";
import { round } from "./money";
import { isWeekday, toIsoDate } from "./time";
import { fetchHistory as cgFetchHistory } from "./pricing/coingecko";

const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

type Tx = Parameters<Parameters<(typeof dbModule)["transaction"]>[0]>[0];
type DbOrTx = DB | Tx;

export type FxBar = {
  iso: string;
  rateToEur: number;
  source: "yahoo-fx" | "coingecko-fx";
};

export type FxRangeResult = {
  currency: string;
  source: FxBar["source"];
  bars: FxBar[];
};

// Currencies Yahoo does not quote via `EURxxx=X` pairs (stablecoins, crypto
// used as quote currency on Binance) fall back to CoinGecko. The map is
// intentionally explicit — an unknown currency should raise, not guess.
const COINGECKO_ID_BY_CURRENCY: Record<string, string> = {
  USDT: "tether",
  USDC: "usd-coin",
  DAI: "dai",
  BUSD: "binance-usd",
  FDUSD: "first-digital-usd",
  TUSD: "true-usd",
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
};


async function fetchFromYahoo(
  ccy: string,
  fromIso: string,
  toIso: string,
): Promise<FxBar[]> {
  const pair = `EUR${ccy}=X`;
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T23:59:59Z`);
  const chart = (await yahoo.chart(pair, {
    period1: from,
    period2: to,
    interval: "1d",
  })) as { quotes?: Array<{ date: Date; close: number | null }> };
  const bars: FxBar[] = [];
  for (const q of chart.quotes ?? []) {
    if (q.close == null || !Number.isFinite(q.close) || q.close <= 0) continue;
    const iso = toIsoDate(q.date);
    if (!isWeekday(iso)) continue;
    // Yahoo quotes xxx-per-EUR, so rateToEur = 1/close.
    bars.push({ iso, rateToEur: round(1 / q.close, 10), source: "yahoo-fx" });
  }
  return bars;
}

async function fetchFromCoinGecko(
  ccy: string,
  fromIso: string,
  toIso: string,
): Promise<FxBar[]> {
  const id = COINGECKO_ID_BY_CURRENCY[ccy];
  if (!id) {
    throw new Error(
      `No CoinGecko id mapped for currency "${ccy}". Extend COINGECKO_ID_BY_CURRENCY.`,
    );
  }
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T23:59:59Z`);
  const history = await cgFetchHistory(id, from, to);
  return history.map((b) => ({
    iso: b.date,
    // CoinGecko returns price in EUR directly, i.e. 1 unit of `ccy` = price EUR.
    rateToEur: round(b.close, 10),
    source: "coingecko-fx" as const,
  }));
}

/**
 * Fetch EUR/{ccy} rates for a date range. Yahoo is tried first; if it
 * throws OR returns zero bars, CoinGecko is tried. If both fail, the
 * combined error propagates. NO writes to the DB happen here — the caller
 * is responsible for persisting, so the whole import pipeline can stay
 * atomic (fetch all data first, then transactionally write).
 */
export async function resolveFxRange(
  ccy: string,
  fromIso: string,
  toIso: string,
): Promise<FxRangeResult> {
  const upper = ccy.toUpperCase();
  if (upper === "EUR") {
    return { currency: upper, source: "yahoo-fx", bars: [] };
  }

  let yahooErr: Error | null = null;
  try {
    const yahooBars = await fetchFromYahoo(upper, fromIso, toIso);
    if (yahooBars.length > 0) {
      return { currency: upper, source: "yahoo-fx", bars: yahooBars };
    }
    yahooErr = new Error("Yahoo returned 0 bars");
  } catch (err) {
    yahooErr = err instanceof Error ? err : new Error(String(err));
  }

  try {
    const cgBars = await fetchFromCoinGecko(upper, fromIso, toIso);
    if (cgBars.length === 0) {
      throw new Error("CoinGecko returned 0 bars");
    }
    return { currency: upper, source: "coingecko-fx", bars: cgBars };
  } catch (cgErr) {
    const cgMsg = cgErr instanceof Error ? cgErr.message : String(cgErr);
    throw new Error(
      `Could not resolve FX for ${upper} (${fromIso} → ${toIso}). ` +
        `Yahoo: ${yahooErr?.message ?? "n/a"}. CoinGecko: ${cgMsg}.`,
    );
  }
}

/**
 * Upsert-write previously-fetched FX bars into `fx_rates`. Safe to call
 * inside a Drizzle transaction — rolls back with everything else on error.
 * Duplicate `(currency, date)` rows are skipped via the unique index.
 */
export function writeFxBars(
  tx: DbOrTx,
  ccy: string,
  bars: FxBar[],
): { inserted: number; skipped: number } {
  const upper = ccy.toUpperCase();
  let inserted = 0;
  let skipped = 0;
  const now = Date.now();
  for (const bar of bars) {
    const existing = tx
      .select({ id: fxRates.id })
      .from(fxRates)
      .where(and(eq(fxRates.currency, upper), eq(fxRates.date, bar.iso)))
      .get();
    if (existing) {
      skipped += 1;
      continue;
    }
    tx.insert(fxRates)
      .values({
        id: ulid(),
        currency: upper,
        date: bar.iso,
        rateToEur: bar.rateToEur,
        source: bar.source,
        createdAt: now,
      })
      .run();
    inserted += 1;
  }
  return { inserted, skipped };
}
