import { desc, eq } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  assetPositions,
  assetTransactions,
  assetValuations,
  assets,
  type Asset,
  type AssetPosition,
  type AssetValuation,
} from "../db/schema";

export type PositionRow = {
  position: AssetPosition;
  asset: Asset;
  valuation: AssetValuation | null;
  valuationEur: number | null;
};

async function latestValuationFor(
  assetId: string,
  db: DB,
): Promise<AssetValuation | null> {
  const row = await db
    .select()
    .from(assetValuations)
    .where(eq(assetValuations.assetId, assetId))
    .orderBy(desc(assetValuations.valuationDate))
    .limit(1)
    .get();
  return row ?? null;
}

export async function listPositions(db: DB = defaultDb): Promise<PositionRow[]> {
  const rows = await db
    .select({ position: assetPositions, asset: assets })
    .from(assetPositions)
    .innerJoin(assets, eq(assets.id, assetPositions.assetId))
    .all();

  const out: PositionRow[] = [];
  for (const row of rows) {
    const valuation = await latestValuationFor(row.position.assetId, db);
    out.push({
      position: row.position,
      asset: row.asset,
      valuation,
      valuationEur: valuation
        ? row.position.quantity * valuation.unitPriceEur
        : null,
    });
  }
  return out;
}

export async function getPositionsByAccount(
  accountId: string,
  db: DB = defaultDb,
): Promise<PositionRow[]> {
  // Positions aren't scoped to an account directly; infer asset coverage from transactions.
  const assetIdsRows = await db
    .selectDistinct({ assetId: assetTransactions.assetId })
    .from(assetTransactions)
    .where(eq(assetTransactions.accountId, accountId))
    .all();
  const assetIds = new Set(assetIdsRows.map((r) => r.assetId));
  if (assetIds.size === 0) return [];

  const all = await listPositions(db);
  return all.filter((row) => assetIds.has(row.position.assetId));
}

export const getPositionsForAccount = getPositionsByAccount;

// Re-export a lightweight helper for other server modules that just need totals.
export async function sumValuationsEur(db: DB = defaultDb): Promise<number> {
  const rows = await listPositions(db);
  return rows.reduce((acc, r) => acc + (r.valuationEur ?? 0), 0);
}
