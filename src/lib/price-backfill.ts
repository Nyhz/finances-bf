import { and, asc, eq, inArray, min } from "drizzle-orm";
import { ulid } from "ulid";
import type { DB } from "../db/client";
import {
  assetTransactions,
  assetValuations,
  assets,
  priceHistory,
} from "../db/schema";
import type { HistoricalBar } from "./pricing";
import { toIsoDate } from "./fx";

export type BackfillClient = {
  fetchHistory: (
    symbol: string,
    from: Date,
    to: Date,
  ) => Promise<HistoricalBar[]>;
};

export type BackfillAssetSummary = {
  assetId: string;
  providerSymbol: string;
  from: string;
  to: string;
  bars: number;
  inserted: number;
  skipped: number;
  error?: string;
};

export type BackfillSummary = {
  date: string;
  assets: BackfillAssetSummary[];
};

/**
 * Backfill CoinGecko daily closes for every active crypto asset that has a
 * `providerSymbol` (CoinGecko coin id) set. The lookback window spans from
 * the asset's earliest trade date to `today`; rows already present for a
 * (symbol, date) pair are left untouched — the function is idempotent.
 */
export async function backfillCryptoPrices(
  db: DB,
  client: BackfillClient,
  today: string = toIsoDate(new Date()),
): Promise<BackfillSummary> {
  const summary: BackfillSummary = { date: today, assets: [] };

  const cryptoAssets = await db
    .select()
    .from(assets)
    .where(and(eq(assets.assetType, "crypto"), eq(assets.isActive, true)))
    .all();

  if (cryptoAssets.length === 0) return summary;

  for (const asset of cryptoAssets) {
    const providerSymbol = asset.providerSymbol?.trim();
    if (!providerSymbol) {
      summary.assets.push({
        assetId: asset.id,
        providerSymbol: "",
        from: today,
        to: today,
        bars: 0,
        inserted: 0,
        skipped: 0,
        error: "missing providerSymbol (CoinGecko coin id)",
      });
      continue;
    }
    const earliest = await db
      .select({ tradedAt: min(assetTransactions.tradedAt) })
      .from(assetTransactions)
      .where(eq(assetTransactions.assetId, asset.id))
      .get();
    const earliestMs = earliest?.tradedAt ?? null;
    if (earliestMs == null) {
      summary.assets.push({
        assetId: asset.id,
        providerSymbol,
        from: today,
        to: today,
        bars: 0,
        inserted: 0,
        skipped: 0,
        error: "no trades yet — nothing to backfill",
      });
      continue;
    }
    // Pad back to the UTC midnight before the earliest trade so CoinGecko's
    // market_chart/range includes a bar on the trade day itself (the API
    // returns one daily point per 24h window starting at 00:00 UTC).
    const earliestIso = toIsoDate(new Date(earliestMs));
    const fromDate = new Date(
      new Date(`${earliestIso}T00:00:00.000Z`).getTime() - 24 * 60 * 60 * 1000,
    );
    const toDate = new Date(`${today}T23:59:59.000Z`);
    let bars: HistoricalBar[] = [];
    try {
      bars = await client.fetchHistory(providerSymbol, fromDate, toDate);
    } catch (err) {
      summary.assets.push({
        assetId: asset.id,
        providerSymbol,
        from: toIsoDate(fromDate),
        to: today,
        bars: 0,
        inserted: 0,
        skipped: 0,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const dates = bars.map((b) => b.date);
    const existing = dates.length
      ? await db
          .select({
            pricedDateUtc: priceHistory.pricedDateUtc,
          })
          .from(priceHistory)
          .where(
            and(
              eq(priceHistory.symbol, providerSymbol),
              eq(priceHistory.source, "coingecko"),
              inArray(priceHistory.pricedDateUtc, dates),
            ),
          )
          .all()
      : [];
    const haveDates = new Set(existing.map((r) => r.pricedDateUtc));

    let inserted = 0;
    let skipped = 0;
    for (const bar of bars) {
      if (haveDates.has(bar.date)) {
        skipped++;
        continue;
      }
      await db
        .insert(priceHistory)
        .values({
          id: ulid(),
          symbol: providerSymbol,
          price: bar.close,
          pricedAt: new Date(`${bar.date}T00:00:00.000Z`).getTime(),
          pricedDateUtc: bar.date,
          source: "coingecko",
          createdAt: Date.now(),
        })
        .run();
      inserted++;
    }

    summary.assets.push({
      assetId: asset.id,
      providerSymbol,
      from: toIsoDate(fromDate),
      to: today,
      bars: bars.length,
      inserted,
      skipped,
    });
  }

  return summary;
}

export type ValuationBackfillAssetSummary = {
  assetId: string;
  providerSymbol: string;
  inserted: number;
  updated: number;
  days: number;
};

export type ValuationBackfillSummary = {
  date: string;
  assets: ValuationBackfillAssetSummary[];
};

/**
 * For every crypto asset with stored CoinGecko price history, reconstruct a
 * per-day `asset_valuations` row by walking the trade ledger to derive the
 * quantity held on each date and multiplying by the close price. Idempotent:
 * existing rows are updated in place so the chart reflects the latest prices.
 */
export async function backfillCryptoValuations(
  db: DB,
  today: string = toIsoDate(new Date()),
): Promise<ValuationBackfillSummary> {
  const summary: ValuationBackfillSummary = { date: today, assets: [] };

  const cryptoAssets = await db
    .select()
    .from(assets)
    .where(and(eq(assets.assetType, "crypto"), eq(assets.isActive, true)))
    .all();
  if (cryptoAssets.length === 0) return summary;

  for (const asset of cryptoAssets) {
    const providerSymbol = asset.providerSymbol?.trim();
    if (!providerSymbol) continue;

    const priceRows = await db
      .select({
        date: priceHistory.pricedDateUtc,
        price: priceHistory.price,
      })
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.symbol, providerSymbol),
          eq(priceHistory.source, "coingecko"),
        ),
      )
      .orderBy(asc(priceHistory.pricedDateUtc))
      .all();
    if (priceRows.length === 0) continue;

    const txRows = await db
      .select({
        tradedAt: assetTransactions.tradedAt,
        transactionType: assetTransactions.transactionType,
        quantity: assetTransactions.quantity,
      })
      .from(assetTransactions)
      .where(eq(assetTransactions.assetId, asset.id))
      .orderBy(asc(assetTransactions.tradedAt))
      .all();

    const existingRows = await db
      .select({
        id: assetValuations.id,
        valuationDate: assetValuations.valuationDate,
      })
      .from(assetValuations)
      .where(eq(assetValuations.assetId, asset.id))
      .all();
    const existingByDate = new Map(
      existingRows.map((r) => [r.valuationDate, r.id]),
    );

    let runningQty = 0;
    let cursor = 0;
    let inserted = 0;
    let updated = 0;

    for (const bar of priceRows) {
      const cutoff = new Date(`${bar.date}T23:59:59.999Z`).getTime();
      while (cursor < txRows.length && txRows[cursor].tradedAt <= cutoff) {
        const t = txRows[cursor];
        const sign = t.transactionType === "buy" ? 1 : -1;
        runningQty += sign * t.quantity;
        cursor++;
      }
      const quantity = Math.max(0, runningQty);
      const unitPriceEur = Math.round(bar.price * 1e6) / 1e6;
      const marketValueEur = Math.round(quantity * unitPriceEur * 100) / 100;
      const existingId = existingByDate.get(bar.date);
      if (existingId) {
        await db
          .update(assetValuations)
          .set({
            quantity,
            unitPriceEur,
            marketValueEur,
            priceSource: "coingecko",
          })
          .where(eq(assetValuations.id, existingId))
          .run();
        updated++;
      } else {
        await db
          .insert(assetValuations)
          .values({
            id: ulid(),
            assetId: asset.id,
            valuationDate: bar.date,
            quantity,
            unitPriceEur,
            marketValueEur,
            priceSource: "coingecko",
            createdAt: Date.now(),
          })
          .run();
        inserted++;
      }
    }

    summary.assets.push({
      assetId: asset.id,
      providerSymbol,
      inserted,
      updated,
      days: priceRows.length,
    });
  }

  return summary;
}
