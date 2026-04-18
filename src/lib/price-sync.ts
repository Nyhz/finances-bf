import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { DB } from "../db/client";
import {
  assetPositions,
  assetValuations,
  assets,
  fxRates,
  priceHistory,
} from "../db/schema";
import { resolveFxRate, toIsoDate, type FxLookup } from "./fx";
import type { Quote } from "./pricing";

export type PriceClient = {
  fetchQuote: (symbol: string) => Promise<Quote>;
};

export type SyncError = {
  assetId?: string;
  symbol?: string;
  currency?: string;
  message: string;
};

export type SyncSummary = {
  date: string;
  fetched: number;
  skipped: number;
  fxFetched: number;
  fxSkipped: number;
  valuationsUpserted: number;
  errors: SyncError[];
};

function resolveSymbol(
  asset: { providerSymbol: string | null; symbol: string | null; ticker: string | null },
): string | null {
  return (
    (asset.providerSymbol && asset.providerSymbol.trim()) ||
    (asset.symbol && asset.symbol.trim()) ||
    (asset.ticker && asset.ticker.trim()) ||
    null
  );
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundUnitPrice(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export async function syncPrices(
  db: DB,
  client: PriceClient,
  today: string = toIsoDate(new Date()),
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    date: today,
    fetched: 0,
    skipped: 0,
    fxFetched: 0,
    fxSkipped: 0,
    valuationsUpserted: 0,
    errors: [],
  };

  const activeAssets = await db
    .select()
    .from(assets)
    .where(eq(assets.isActive, true))
    .all();

  // Quote currency per asset, populated as we fetch. Authoritative source of
  // truth for FX conversion — the asset row's `currency` reflects trade
  // currency (as imported), which may differ from the Yahoo quote currency
  // for ADRs, dual-listed funds, etc.
  const quoteCurrencyByAsset = new Map<string, string>();

  // 1. Asset prices
  for (const asset of activeAssets) {
    const symbol = resolveSymbol(asset);
    if (!symbol) {
      summary.errors.push({
        assetId: asset.id,
        message: "no provider symbol / symbol / ticker set",
      });
      continue;
    }
    const existing = await db
      .select()
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.symbol, symbol),
          eq(priceHistory.pricedDateUtc, today),
          eq(priceHistory.source, "yahoo"),
        ),
      )
      .get();
    if (existing) {
      // Already priced today; fall back to the asset row's currency since we
      // no longer have a fresh quote to read.
      if (asset.currency) {
        quoteCurrencyByAsset.set(asset.id, asset.currency.toUpperCase());
      }
      summary.skipped++;
      continue;
    }
    try {
      const quote = await client.fetchQuote(symbol);
      quoteCurrencyByAsset.set(asset.id, quote.currency.toUpperCase());
      await db
        .insert(priceHistory)
        .values({
          id: ulid(),
          symbol,
          price: quote.price,
          pricedAt: quote.asOf.getTime(),
          pricedDateUtc: today,
          source: "yahoo",
          createdAt: Date.now(),
        })
        .run();
      summary.fetched++;
    } catch (err) {
      summary.errors.push({
        assetId: asset.id,
        symbol,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. FX rates — one row per non-EUR quote currency seen in this run.
  const currencySet = new Set<string>();
  for (const ccy of quoteCurrencyByAsset.values()) {
    if (ccy && ccy !== "EUR") currencySet.add(ccy);
  }
  for (const ccy of currencySet) {
    const existing = await db
      .select()
      .from(fxRates)
      .where(and(eq(fxRates.currency, ccy), eq(fxRates.date, today)))
      .get();
    if (existing) {
      summary.fxSkipped++;
      continue;
    }
    const pair = `EUR${ccy}=X`;
    try {
      const quote = await client.fetchQuote(pair);
      if (!quote.price || quote.price <= 0) {
        throw new Error(`invalid FX quote for ${pair}: ${quote.price}`);
      }
      const rateToEur = 1 / quote.price;
      await db
        .insert(fxRates)
        .values({
          id: ulid(),
          currency: ccy,
          date: today,
          rateToEur,
          source: "yahoo",
          createdAt: Date.now(),
        })
        .run();
      summary.fxFetched++;
    } catch (err) {
      summary.errors.push({
        currency: ccy,
        symbol: pair,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. Recompute valuations for each asset that now has a price row today.
  const fxLookup: FxLookup = {
    findOnDate: async (currency, iso) =>
      (await db
        .select()
        .from(fxRates)
        .where(and(eq(fxRates.currency, currency), eq(fxRates.date, iso)))
        .get()) ?? null,
    findLatest: async (currency, onOrBefore) => {
      const rows = await db
        .select()
        .from(fxRates)
        .where(eq(fxRates.currency, currency))
        .all();
      const filtered = onOrBefore
        ? rows.filter((r) => r.date <= onOrBefore)
        : rows;
      filtered.sort((a, b) => b.date.localeCompare(a.date));
      return filtered[0] ?? null;
    },
  };

  for (const asset of activeAssets) {
    const symbol = resolveSymbol(asset);
    if (!symbol) continue;
    const priceRow = await db
      .select()
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.symbol, symbol),
          eq(priceHistory.pricedDateUtc, today),
        ),
      )
      .get();
    if (!priceRow) continue;

    try {
      const quoteCurrency =
        quoteCurrencyByAsset.get(asset.id) ?? asset.currency;
      const fx = await resolveFxRate(quoteCurrency, today, fxLookup);
      const unitPriceEur = roundUnitPrice(priceRow.price * fx.rate);
      const positionRow = await db
        .select()
        .from(assetPositions)
        .where(eq(assetPositions.assetId, asset.id))
        .get();
      const quantity = positionRow?.quantity ?? 0;
      const marketValueEur = roundMoney(quantity * unitPriceEur);

      const existing = await db
        .select()
        .from(assetValuations)
        .where(
          and(
            eq(assetValuations.assetId, asset.id),
            eq(assetValuations.valuationDate, today),
          ),
        )
        .get();

      if (existing) {
        await db
          .update(assetValuations)
          .set({
            quantity,
            unitPriceEur,
            marketValueEur,
            priceSource: priceRow.source,
          })
          .where(eq(assetValuations.id, existing.id))
          .run();
      } else {
        await db
          .insert(assetValuations)
          .values({
            id: ulid(),
            assetId: asset.id,
            valuationDate: today,
            quantity,
            unitPriceEur,
            marketValueEur,
            priceSource: priceRow.source,
            createdAt: Date.now(),
          })
          .run();
      }
      summary.valuationsUpserted++;
    } catch (err) {
      summary.errors.push({
        assetId: asset.id,
        symbol,
        currency: asset.currency,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
