import { asc, eq } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  assetPositions,
  assets,
  type Asset,
  type AssetPosition,
} from "../db/schema";

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
