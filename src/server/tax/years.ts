import { max, min } from "drizzle-orm";
import { db as defaultDb, type DB } from "../../db/client";
import { accountCashMovements, assetTransactions } from "../../db/schema";

/**
 * Distinct years with activity, newest first. Uses min/max aggregates and
 * enumerates the span instead of loading every row (audit P5) — the year
 * list is contiguous in practice, and a year with zero rows simply renders
 * an empty report.
 */
export async function getTaxYears(db: DB = defaultDb): Promise<number[]> {
  const tradeBounds = db
    .select({ lo: min(assetTransactions.tradedAt), hi: max(assetTransactions.tradedAt) })
    .from(assetTransactions)
    .get();
  const cashBounds = db
    .select({ lo: min(accountCashMovements.occurredAt), hi: max(accountCashMovements.occurredAt) })
    .from(accountCashMovements)
    .get();

  const los = [tradeBounds?.lo, cashBounds?.lo].filter((v): v is number => v != null);
  const his = [tradeBounds?.hi, cashBounds?.hi].filter((v): v is number => v != null);
  if (los.length === 0 || his.length === 0) return [];

  const firstYear = new Date(Math.min(...los)).getUTCFullYear();
  const lastYear = new Date(Math.max(...his)).getUTCFullYear();
  const years: number[] = [];
  for (let y = lastYear; y >= firstYear; y--) years.push(y);
  return years;
}
