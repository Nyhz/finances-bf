import { asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import YahooFinance from "yahoo-finance2";
import { db } from "../src/db/client";
import {
  assetTransactions,
  assetValuations,
  assets,
  fxRates,
  priceHistory,
} from "../src/db/schema";
import { toIsoDate } from "../src/lib/fx";

const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

type ChartBar = {
  date: Date;
  close: number | null;
};

type ChartResult = {
  meta?: { currency?: string };
  quotes?: ChartBar[];
};

function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function isWeekday(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
}

function weekdaysBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const end = new Date(`${toIso}T12:00:00Z`).getTime();
  for (
    let t = new Date(`${fromIso}T12:00:00Z`).getTime();
    t <= end;
    t += 86_400_000
  ) {
    const iso = toIsoDate(new Date(t));
    if (isWeekday(iso)) out.push(iso);
  }
  return out;
}

async function fetchChart(
  symbol: string,
  fromIso: string,
): Promise<ChartResult | null> {
  const period1 = new Date(`${fromIso}T00:00:00Z`);
  const period2 = new Date();
  try {
    return (await yahoo.chart(symbol, {
      period1,
      period2,
      interval: "1d",
    })) as ChartResult;
  } catch (err) {
    console.error(`  chart(${symbol}) failed:`, (err as Error).message);
    return null;
  }
}

async function main() {
  const now = Date.now();
  const today = toIsoDate(new Date());

  const allAssets = db.select().from(assets).where(eq(assets.isActive, true)).all();
  console.log(`Backfilling ${allAssets.length} active assets...`);

  // Track the prices per (asset, date) in native currency + each asset's
  // currency — used later for valuation computation.
  const assetPrices: Record<
    string,
    { currency: string; byDate: Map<string, number>; providerSymbol: string }
  > = {};

  // Track minimum fromDate across all assets to bound FX fetches.
  let globalMin: string | null = null;

  for (const asset of allAssets) {
    const symbol = (asset.providerSymbol ?? asset.symbol ?? asset.ticker ?? "").trim();
    if (!symbol) {
      console.log(`  skip ${asset.name}: no symbol`);
      continue;
    }

    const firstTx = db
      .select()
      .from(assetTransactions)
      .where(eq(assetTransactions.assetId, asset.id))
      .orderBy(asc(assetTransactions.tradedAt))
      .get();
    if (!firstTx) {
      console.log(`  skip ${asset.name}: no transactions`);
      continue;
    }

    const fromIso = toIsoDate(new Date(firstTx.tradedAt));
    if (!globalMin || fromIso < globalMin) globalMin = fromIso;

    console.log(`  ${asset.name} [${symbol}] from ${fromIso}`);
    const chart = await fetchChart(symbol, fromIso);
    if (!chart?.quotes?.length) {
      console.log(`    no bars returned`);
      continue;
    }
    const currency = (chart.meta?.currency ?? "EUR").toUpperCase();

    const byDate = new Map<string, number>();
    let inserted = 0;
    for (const bar of chart.quotes) {
      if (!bar.close || !Number.isFinite(bar.close)) continue;
      const iso = toIsoDate(bar.date);
      if (!isWeekday(iso)) continue;
      byDate.set(iso, bar.close);

      try {
        db
          .insert(priceHistory)
          .values({
            id: ulid(),
            symbol,
            pricedAt: bar.date.getTime(),
            pricedDateUtc: iso,
            price: bar.close,
            source: "yahoo-backfill",
            createdAt: now,
          })
          .run();
        inserted += 1;
      } catch {
        // duplicate on unique (symbol, priced_date_utc) — skip
      }
    }
    console.log(`    ${byDate.size} bars, ${inserted} new price_history rows (${currency})`);
    assetPrices[asset.id] = { currency, byDate, providerSymbol: symbol };
  }

  // FX backfill per non-EUR currency.
  const currencies = new Set<string>();
  for (const info of Object.values(assetPrices)) {
    if (info.currency !== "EUR") currencies.add(info.currency);
  }

  const fxByCcy: Record<string, Map<string, number>> = {};
  if (globalMin && currencies.size > 0) {
    for (const ccy of currencies) {
      const pair = `EUR${ccy}=X`;
      console.log(`FX ${ccy}: fetching ${pair} from ${globalMin}`);
      const chart = await fetchChart(pair, globalMin);
      const map = new Map<string, number>();
      let inserted = 0;
      for (const bar of chart?.quotes ?? []) {
        if (!bar.close || !Number.isFinite(bar.close)) continue;
        const iso = toIsoDate(bar.date);
        if (!isWeekday(iso)) continue;
        // EURxxx=X close is native-per-EUR. rateToEur = 1/close.
        const rateToEur = round(1 / bar.close, 10);
        map.set(iso, rateToEur);

        try {
          db
            .insert(fxRates)
            .values({
              id: ulid(),
              currency: ccy,
              date: iso,
              rateToEur,
              source: "yahoo-backfill",
              createdAt: now,
            })
            .run();
          inserted += 1;
        } catch {
          // duplicate (currency, date) — skip
        }
      }
      fxByCcy[ccy] = map;
      console.log(`  ${map.size} FX bars, ${inserted} new fx_rates rows`);
    }
  }

  // Helper: resolve fxToEur for a currency on a date (falls back to nearest
  // prior date if the exact one is missing — handles holidays).
  function resolveFx(ccy: string, iso: string): number | null {
    if (ccy === "EUR") return 1;
    const map = fxByCcy[ccy];
    if (!map) return null;
    if (map.has(iso)) return map.get(iso)!;
    // Walk back up to 7 days.
    for (let i = 1; i <= 7; i++) {
      const t = new Date(`${iso}T12:00:00Z`).getTime() - i * 86_400_000;
      const prev = toIsoDate(new Date(t));
      if (map.has(prev)) return map.get(prev)!;
    }
    return null;
  }

  function resolvePrice(info: (typeof assetPrices)[string], iso: string): number | null {
    if (info.byDate.has(iso)) return info.byDate.get(iso)!;
    for (let i = 1; i <= 7; i++) {
      const t = new Date(`${iso}T12:00:00Z`).getTime() - i * 86_400_000;
      const prev = toIsoDate(new Date(t));
      if (info.byDate.has(prev)) return info.byDate.get(prev)!;
    }
    return null;
  }

  // Asset valuations per weekday.
  let valuationsInserted = 0;
  for (const [assetId, info] of Object.entries(assetPrices)) {
    const trades = db
      .select()
      .from(assetTransactions)
      .where(eq(assetTransactions.assetId, assetId))
      .orderBy(asc(assetTransactions.tradedAt))
      .all();
    if (trades.length === 0) continue;

    const firstIso = toIsoDate(new Date(trades[0].tradedAt));
    const days = weekdaysBetween(firstIso, today);

    for (const day of days) {
      // Quantity held at end-of-day.
      const dayEnd = new Date(`${day}T23:59:59Z`).getTime();
      let qty = 0;
      for (const t of trades) {
        if (t.tradedAt > dayEnd) break;
        if (t.transactionType === "buy") qty += t.quantity;
        else if (t.transactionType === "sell") qty -= t.quantity;
      }
      if (qty <= 0) continue;

      const price = resolvePrice(info, day);
      if (price == null) continue;
      const fx = resolveFx(info.currency, day);
      if (fx == null) continue;

      const unitPriceEur = round(price * fx, 6);
      const marketValueEur = round(unitPriceEur * qty, 2);

      try {
        db
          .insert(assetValuations)
          .values({
            id: ulid(),
            assetId,
            valuationDate: day,
            quantity: round(qty, 10),
            unitPriceEur,
            marketValueEur,
            priceSource: "backfill",
            createdAt: now,
          })
          .run();
        valuationsInserted += 1;
      } catch {
        // duplicate (asset, date) — skip
      }
    }
  }

  console.log(`\nvaluations inserted: ${valuationsInserted}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
