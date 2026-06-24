import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  assets,
  priceAlerts,
  priceHistory,
  watchlistQuotes,
  type Asset,
  type PriceAlert,
  type WatchlistQuote,
} from "../db/schema";

export type WatchlistSparkPoint = {
  date: string;
  unitPriceEur: number;
  valueEur: number;
  investedEur: number;
};

export type WatchlistItem = {
  asset: Asset;
  /** Latest intraday quote (≈15 min cache). Native quote currency. */
  quote: WatchlistQuote | null;
  /** Most recent daily close from `price_history` (native quote currency). */
  lastClose: number | null;
  /** Short close series for the card sparkline (oldest → newest). */
  series: WatchlistSparkPoint[];
  alerts: PriceAlert[];
};

const SPARK_DAYS = 60;

function symbolOf(a: Asset): string | null {
  return a.providerSymbol?.trim() || a.symbol?.trim() || a.ticker?.trim() || null;
}

export async function listWatchlist(db: DB = defaultDb): Promise<WatchlistItem[]> {
  const watched = await db
    .select()
    .from(assets)
    .where(eq(assets.isWatchlisted, true))
    .orderBy(asc(assets.name))
    .all();
  if (watched.length === 0) return [];

  const ids = watched.map((a) => a.id);

  const quotes = await db
    .select()
    .from(watchlistQuotes)
    .where(inArray(watchlistQuotes.assetId, ids))
    .all();
  const quoteByAsset = new Map(quotes.map((q) => [q.assetId, q]));

  const alerts = await db
    .select()
    .from(priceAlerts)
    .where(inArray(priceAlerts.assetId, ids))
    .orderBy(asc(priceAlerts.createdAt))
    .all();
  const alertsByAsset = new Map<string, PriceAlert[]>();
  for (const al of alerts) {
    const list = alertsByAsset.get(al.assetId) ?? [];
    list.push(al);
    alertsByAsset.set(al.assetId, list);
  }

  // Daily closes for the sparkline + last close, in one query across all symbols.
  const symbols = [...new Set(watched.map(symbolOf).filter((s): s is string => !!s))];
  const seriesBySymbol = new Map<string, WatchlistSparkPoint[]>();
  if (symbols.length > 0) {
    const rows = await db
      .select({
        symbol: priceHistory.symbol,
        date: priceHistory.pricedDateUtc,
        price: priceHistory.price,
      })
      .from(priceHistory)
      .where(inArray(priceHistory.symbol, symbols))
      .orderBy(asc(priceHistory.symbol), desc(priceHistory.pricedDateUtc))
      .all();
    // rows are newest-first per symbol; keep the last SPARK_DAYS, then reverse.
    const counts = new Map<string, number>();
    for (const r of rows) {
      const n = counts.get(r.symbol) ?? 0;
      if (n >= SPARK_DAYS) continue;
      counts.set(r.symbol, n + 1);
      const list = seriesBySymbol.get(r.symbol) ?? [];
      list.push({ date: r.date, unitPriceEur: r.price, valueEur: 0, investedEur: 0 });
      seriesBySymbol.set(r.symbol, list);
    }
    for (const [sym, list] of seriesBySymbol) seriesBySymbol.set(sym, list.reverse());
  }

  return watched.map((asset) => {
    const sym = symbolOf(asset);
    const series = sym ? (seriesBySymbol.get(sym) ?? []) : [];
    const lastClose = series.length > 0 ? series[series.length - 1].unitPriceEur : null;
    return {
      asset,
      quote: quoteByAsset.get(asset.id) ?? null,
      lastClose,
      series,
      alerts: alertsByAsset.get(asset.id) ?? [],
    };
  });
}

export async function countWatchlist(db: DB = defaultDb): Promise<number> {
  const rows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.isWatchlisted, true)))
    .all();
  return rows.length;
}
