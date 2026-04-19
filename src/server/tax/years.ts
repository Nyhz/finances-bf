import { db as defaultDb, type DB } from "../../db/client";
import { accountCashMovements, assetTransactions } from "../../db/schema";

export async function getTaxYears(db: DB = defaultDb): Promise<number[]> {
  const rows = await db.select({ tradedAt: assetTransactions.tradedAt }).from(assetTransactions).all();
  const cash = await db.select({ occurredAt: accountCashMovements.occurredAt }).from(accountCashMovements).all();
  const years = new Set<number>();
  for (const r of rows) years.add(new Date(r.tradedAt).getUTCFullYear());
  for (const r of cash) years.add(new Date(r.occurredAt).getUTCFullYear());
  return [...years].sort((a, b) => b - a);
}
