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
import { resolveSymbol } from "./price-sync";
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

// ---------------------------------------------------------------------------
// Shared core. Both the crypto (CoinGecko) and fund (FT) backfills write the
// same EUR-native shape into price_history / asset_valuations — only the asset
// selection, the price_history (symbol, source) key, and the lookback window
// differ. These two helpers carry the idempotent insert and the ledger-walk so
// the per-provider wrappers stay thin.
// ---------------------------------------------------------------------------

/** Insert daily bars into price_history for one (symbol, source) idempotently.
 *  Existence check + inserts run in ONE transaction (audit R3/P3) so a
 *  concurrent run can't race past the check onto the unique index. */
function insertBars(
  db: DB,
  symbol: string,
  source: string,
  bars: HistoricalBar[],
): { inserted: number; skipped: number } {
  return db.transaction((tx) => {
    const dates = bars.map((b) => b.date);
    const existing = dates.length
      ? tx
          .select({ pricedDateUtc: priceHistory.pricedDateUtc })
          .from(priceHistory)
          .where(
            and(
              eq(priceHistory.symbol, symbol),
              eq(priceHistory.source, source),
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
      tx
        .insert(priceHistory)
        .values({
          id: ulid(),
          symbol,
          price: bar.close,
          pricedAt: new Date(`${bar.date}T00:00:00.000Z`).getTime(),
          pricedDateUtc: bar.date,
          source,
          createdAt: Date.now(),
        })
        .run();
      inserted++;
    }
    return { inserted, skipped };
  });
}

/** Rebuild every per-day asset_valuations row for one asset from its stored
 *  (symbol, source) price history, walking the trade ledger to derive the
 *  quantity held on each date. EUR-native: the stored close is taken as the
 *  unit price in EUR directly (CoinGecko is EUR; FT funds priced here are EUR).
 *  Idempotent — existing rows are updated in place. */
function rebuildValuations(
  db: DB,
  assetId: string,
  symbol: string,
  source: string,
  // When true, days the asset wasn't held (qty <= 0) get NO valuation row —
  // matching the app convention (`rebuildValuationsForAsset` skips them). Used
  // by funds so a holding bought today isn't back-valued on days it didn't
  // exist. Crypto keeps the legacy behaviour (qty-0 rows) by default.
  skipZeroQty = false,
): { inserted: number; updated: number; days: number } | null {
  return db.transaction((tx) => {
    const priceRows = tx
      .select({ date: priceHistory.pricedDateUtc, price: priceHistory.price })
      .from(priceHistory)
      .where(and(eq(priceHistory.symbol, symbol), eq(priceHistory.source, source)))
      .orderBy(asc(priceHistory.pricedDateUtc))
      .all();
    if (priceRows.length === 0) return null;

    const txRows = tx
      .select({
        tradedAt: assetTransactions.tradedAt,
        transactionType: assetTransactions.transactionType,
        quantity: assetTransactions.quantity,
      })
      .from(assetTransactions)
      .where(eq(assetTransactions.assetId, assetId))
      .orderBy(asc(assetTransactions.tradedAt))
      .all();

    const existingRows = tx
      .select({
        id: assetValuations.id,
        valuationDate: assetValuations.valuationDate,
      })
      .from(assetValuations)
      .where(eq(assetValuations.assetId, assetId))
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
      const existingId = existingByDate.get(bar.date);
      if (skipZeroQty && quantity <= 0) {
        // Not held on this day → no valuation. Remove any stale row so the
        // rebuild is idempotent (e.g. clearing earlier qty-0 backfill noise).
        if (existingId) {
          tx.delete(assetValuations).where(eq(assetValuations.id, existingId)).run();
        }
        continue;
      }
      const unitPriceEur = Math.round(bar.price * 1e6) / 1e6;
      const marketValueEur = Math.round(quantity * unitPriceEur * 100) / 100;
      if (existingId) {
        tx
          .update(assetValuations)
          .set({ quantity, unitPriceEur, marketValueEur, priceSource: source })
          .where(eq(assetValuations.id, existingId))
          .run();
        updated++;
      } else {
        tx
          .insert(assetValuations)
          .values({
            id: ulid(),
            assetId,
            valuationDate: bar.date,
            quantity,
            unitPriceEur,
            marketValueEur,
            priceSource: source,
            createdAt: Date.now(),
          })
          .run();
        inserted++;
      }
    }
    return { inserted, updated, days: priceRows.length };
  });
}

/** Earliest trade date (UTC ms) for an asset, or null if it has none yet. */
async function earliestTradeMs(db: DB, assetId: string): Promise<number | null> {
  const row = await db
    .select({ tradedAt: min(assetTransactions.tradedAt) })
    .from(assetTransactions)
    .where(eq(assetTransactions.assetId, assetId))
    .get();
  return row?.tradedAt ?? null;
}

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
    const earliestMs = await earliestTradeMs(db, asset.id);
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

    const { inserted, skipped } = insertBars(db, providerSymbol, "coingecko", bars);
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
 * quantity held on each date and multiplying by the close price. Idempotent.
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
    const result = rebuildValuations(db, asset.id, providerSymbol, "coingecko");
    if (!result) continue;
    summary.assets.push({
      assetId: asset.id,
      providerSymbol,
      inserted: result.inserted,
      updated: result.updated,
      days: result.days,
    });
  }

  return summary;
}

// ---------------------------------------------------------------------------
// FT funds. Keyed by the public `ISIN:CURRENCY` symbol with source "ft" — the
// same key the daily sync writes, so backfill and live sync form one series.
// EUR-native (the funds priced here trade in EUR); a non-EUR fund is flagged
// rather than silently mis-valued without an FX conversion.
// ---------------------------------------------------------------------------

/**
 * Backfill FT daily NAVs for every active asset whose `priceSource` is "ft".
 * The window runs from `opts.from` (when given — e.g. the portfolio's first
 * ever investment, to seed a long test series) or otherwise the asset's first
 * trade, to `today`. Idempotent.
 */
export async function backfillFundPrices(
  db: DB,
  client: BackfillClient,
  today: string = toIsoDate(new Date()),
  opts: { from?: Date } = {},
): Promise<BackfillSummary> {
  const summary: BackfillSummary = { date: today, assets: [] };

  const fundAssets = await db
    .select()
    .from(assets)
    .where(and(eq(assets.priceSource, "ft"), eq(assets.isActive, true)))
    .all();
  if (fundAssets.length === 0) return summary;

  const toDate = new Date(`${today}T23:59:59.000Z`);

  for (const asset of fundAssets) {
    const symbol = resolveSymbol(asset, "ft");
    const push = (extra: Partial<BackfillAssetSummary>) =>
      summary.assets.push({
        assetId: asset.id,
        providerSymbol: symbol ?? "",
        from: today,
        to: today,
        bars: 0,
        inserted: 0,
        skipped: 0,
        ...extra,
      });

    if (!symbol) {
      push({ error: "FT asset missing ISIN" });
      continue;
    }
    if ((asset.currency ?? "EUR").toUpperCase() !== "EUR") {
      push({ error: "FT backfill only supports EUR funds (no FX applied)" });
      continue;
    }

    let fromDate = opts.from ?? null;
    if (!fromDate) {
      const earliestMs = await earliestTradeMs(db, asset.id);
      if (earliestMs == null) {
        push({ error: "no trades yet — nothing to backfill" });
        continue;
      }
      fromDate = new Date(`${toIsoDate(new Date(earliestMs))}T00:00:00.000Z`);
    }

    let bars: HistoricalBar[] = [];
    try {
      bars = await client.fetchHistory(symbol, fromDate, toDate);
    } catch (err) {
      push({
        from: toIsoDate(fromDate),
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const { inserted, skipped } = insertBars(db, symbol, "ft", bars);
    push({
      from: toIsoDate(fromDate),
      to: today,
      bars: bars.length,
      inserted,
      skipped,
    });
  }

  return summary;
}

/**
 * Reconstruct per-day `asset_valuations` for every FT fund from its stored FT
 * price history. EUR-native; idempotent. Mirrors `backfillCryptoValuations`.
 */
export async function backfillFundValuations(
  db: DB,
  today: string = toIsoDate(new Date()),
): Promise<ValuationBackfillSummary> {
  const summary: ValuationBackfillSummary = { date: today, assets: [] };

  const fundAssets = await db
    .select()
    .from(assets)
    .where(and(eq(assets.priceSource, "ft"), eq(assets.isActive, true)))
    .all();
  if (fundAssets.length === 0) return summary;

  for (const asset of fundAssets) {
    const symbol = resolveSymbol(asset, "ft");
    if (!symbol) continue;
    // skipZeroQty: only value days the fund was actually held AND has a real
    // NAV — never back-value or carry a stale price onto unheld days.
    const result = rebuildValuations(db, asset.id, symbol, "ft", true);
    if (!result) continue;
    summary.assets.push({
      assetId: asset.id,
      providerSymbol: symbol,
      inserted: result.inserted,
      updated: result.updated,
      days: result.days,
    });
  }

  return summary;
}
