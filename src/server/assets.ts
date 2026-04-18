import { asc, desc, eq } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  assetPositions,
  assets,
  priceHistory,
  type Asset,
  type AssetPosition,
} from "../db/schema";

export type PriceFreshness = {
  pricedAt: number;
  source: "yahoo" | "manual" | "stale";
} | null;

export type AssetListRow = Asset & {
  freshness: PriceFreshness;
};

const STALE_MS = 1000 * 60 * 60 * 24 * 3; // 3 days

export async function listAssetsWithFreshness(
  db: DB = defaultDb,
): Promise<AssetListRow[]> {
  const rows = await db.select().from(assets).orderBy(asc(assets.name)).all();
  const positions = await db.select().from(assetPositions).all();
  const posByAsset = new Map(positions.map((p) => [p.assetId, p]));
  const now = Date.now();
  return Promise.all(
    rows.map(async (asset) => {
      const pos = posByAsset.get(asset.id);
      let freshness: PriceFreshness = null;
      if (pos?.manualPrice != null && pos.manualPriceAsOf != null) {
        freshness = { pricedAt: pos.manualPriceAsOf, source: "manual" };
      } else {
        const symbol = asset.providerSymbol ?? asset.symbol ?? asset.ticker;
        if (symbol) {
          const last = await db
            .select({ pricedAt: priceHistory.pricedAt })
            .from(priceHistory)
            .where(eq(priceHistory.symbol, symbol))
            .orderBy(desc(priceHistory.pricedAt))
            .limit(1)
            .get();
          if (last) {
            const source = now - last.pricedAt > STALE_MS ? "stale" : "yahoo";
            freshness = { pricedAt: last.pricedAt, source };
          }
        }
      }
      return { ...asset, freshness };
    }),
  );
}

export async function listAssets(db: DB = defaultDb): Promise<Asset[]> {
  return db.select().from(assets).orderBy(asc(assets.name)).all();
}

export async function getActiveAssets(db: DB = defaultDb): Promise<Asset[]> {
  return db.select().from(assets).where(eq(assets.isActive, true)).orderBy(asc(assets.name)).all();
}

export async function getAsset(id: string, db: DB = defaultDb): Promise<Asset | null> {
  const row = await db.select().from(assets).where(eq(assets.id, id)).get();
  return row ?? null;
}

export type AssetWithPosition = {
  asset: Asset;
  position: AssetPosition | null;
};

export async function getAssetWithPositions(
  id: string,
  db: DB = defaultDb,
): Promise<AssetWithPosition | null> {
  const asset = await getAsset(id, db);
  if (!asset) return null;
  const position =
    (await db.select().from(assetPositions).where(eq(assetPositions.assetId, id)).get()) ?? null;
  return { asset, position };
}
