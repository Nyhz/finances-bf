import { and, eq, inArray } from "drizzle-orm";
import { ulid } from "ulid";
import type { DB } from "../db/client";
import { assetSectorWeightings, assets } from "../db/schema";
import { resolveSymbol } from "./price-sync";
import { COMMODITY_SUBTYPE } from "./sectors";
import type { SectorWeight } from "./pricing";

export type SectorClient = {
  /** ETFs/funds: full sector breakdown from `topHoldings`. */
  fetchSectorWeightings: (symbol: string) => Promise<SectorWeight[]>;
  /** Individual stocks: single sector from `assetProfile`, or null. */
  fetchAssetSector: (symbol: string) => Promise<string | null>;
};

export type SectorSyncError = {
  assetId?: string;
  symbol?: string;
  message: string;
};

export type SectorSyncSummary = {
  refreshed: number;
  skipped: number;
  errors: SectorSyncError[];
};

/** Equity baskets get a full breakdown; individual stocks get a single sector.
 *  Crypto and commodities (gold ETCs) are bucketed by the read layer, not here,
 *  so they're excluded — querying Yahoo fundamentals for them just errors. */
const SECTOR_ASSET_TYPES = ["etf", "fund", "stock"] as const;

/** Sector composition barely moves; refresh weekly. The cron runs daily but
 *  this freshness gate keeps it idempotent within (and well beyond) a day. */
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** A single stock is 100% one sector (or nothing, if Yahoo has no profile). */
async function fetchStockSector(
  client: SectorClient,
  symbol: string,
): Promise<SectorWeight[]> {
  const sector = await client.fetchAssetSector(symbol);
  return sector ? [{ sector, weight: 1 }] : [];
}

export async function syncSectorWeightings(
  db: DB,
  client: SectorClient,
  now: number,
  opts: { staleAfterMs?: number } = {},
): Promise<SectorSyncSummary> {
  const staleAfterMs = opts.staleAfterMs ?? STALE_AFTER_MS;
  const summary: SectorSyncSummary = { refreshed: 0, skipped: 0, errors: [] };

  const targets = await db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.isActive, true),
        inArray(assets.assetType, SECTOR_ASSET_TYPES as unknown as string[]),
      ),
    )
    .all();

  for (const asset of targets) {
    // Commodity ETPs (e.g. physical gold) have no equity sector — the read
    // layer buckets them as "Materias primas". Skip the doomed Yahoo call.
    if (asset.subtype === COMMODITY_SUBTYPE) continue;

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
      .from(assetSectorWeightings)
      .where(eq(assetSectorWeightings.assetId, asset.id))
      .all();
    const newestFetchedAt = existing.reduce((m, r) => Math.max(m, r.fetchedAt), 0);
    if (existing.length > 0 && now - newestFetchedAt < staleAfterMs) {
      summary.skipped++;
      continue;
    }

    try {
      const weights =
        asset.assetType === "stock"
          ? await fetchStockSector(client, symbol)
          : await client.fetchSectorWeightings(symbol);
      // Snapshot replace: drop the previous breakdown so a sector that fell out
      // of the fund doesn't linger. Sectors are tiny per asset; not worth a tx.
      await db
        .delete(assetSectorWeightings)
        .where(eq(assetSectorWeightings.assetId, asset.id))
        .run();
      for (const w of weights) {
        if (!(w.weight > 0)) continue;
        await db
          .insert(assetSectorWeightings)
          .values({
            id: ulid(),
            assetId: asset.id,
            sector: w.sector,
            weight: w.weight,
            source: "yahoo",
            fetchedAt: now,
            createdAt: now,
          })
          .run();
      }
      summary.refreshed++;
    } catch (err) {
      summary.errors.push({
        assetId: asset.id,
        symbol,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
