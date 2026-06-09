import { and, eq, inArray, max, or } from "drizzle-orm";
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

/** Latest valuation per asset in two queries (audit P2) instead of one
 *  query per position: max(valuationDate) grouped by asset, then the exact
 *  rows via the (assetId, valuationDate) unique index. */
async function latestValuationsFor(
  assetIds: string[],
  db: DB,
): Promise<Map<string, AssetValuation>> {
  if (assetIds.length === 0) return new Map();
  const latest = await db
    .select({
      assetId: assetValuations.assetId,
      latestDate: max(assetValuations.valuationDate),
    })
    .from(assetValuations)
    .where(inArray(assetValuations.assetId, assetIds))
    .groupBy(assetValuations.assetId)
    .all();
  const pairs = latest.filter((r): r is { assetId: string; latestDate: string } => r.latestDate != null);
  if (pairs.length === 0) return new Map();
  const rows = await db
    .select()
    .from(assetValuations)
    .where(
      or(
        ...pairs.map((pair) =>
          and(
            eq(assetValuations.assetId, pair.assetId),
            eq(assetValuations.valuationDate, pair.latestDate),
          ),
        ),
      ),
    )
    .all();
  return new Map(rows.map((v) => [v.assetId, v]));
}

export async function listPositions(db: DB = defaultDb): Promise<PositionRow[]> {
  const rows = await db
    .select({ position: assetPositions, asset: assets })
    .from(assetPositions)
    .innerJoin(assets, eq(assets.id, assetPositions.assetId))
    .all();

  const valuationByAsset = await latestValuationsFor(
    rows.map((r) => r.position.assetId),
    db,
  );
  return rows.map((row) => {
    const valuation = valuationByAsset.get(row.position.assetId) ?? null;
    return {
      position: row.position,
      asset: row.asset,
      valuation,
      valuationEur: valuation
        ? row.position.quantity * valuation.unitPriceEur
        : null,
    };
  });
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
