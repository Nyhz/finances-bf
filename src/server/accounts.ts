import { asc, eq } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { accounts, type Account } from "../db/schema";

export type AccountWithTotals = Account & {
  totalBalanceEur: number;
};

export async function listAccounts(db: DB = defaultDb): Promise<AccountWithTotals[]> {
  const rows = await db.select().from(accounts).orderBy(asc(accounts.name)).all();
  return rows.map((row) => ({ ...row, totalBalanceEur: row.currentCashBalanceEur }));
}

export async function getAccount(id: string, db: DB = defaultDb): Promise<Account | null> {
  const row = await db.select().from(accounts).where(eq(accounts.id, id)).get();
  return row ?? null;
}

export type AccountsSummary = {
  count: number;
  totalEur: number;
  byCurrency: Record<string, { count: number; totalEur: number }>;
};

export async function getAccountsSummary(db: DB = defaultDb): Promise<AccountsSummary> {
  const rows = await db.select().from(accounts).all();
  const byCurrency: Record<string, { count: number; totalEur: number }> = {};
  let totalEur = 0;
  for (const row of rows) {
    totalEur += row.currentCashBalanceEur;
    const bucket = byCurrency[row.currency] ?? { count: 0, totalEur: 0 };
    bucket.count += 1;
    bucket.totalEur += row.currentCashBalanceEur;
    byCurrency[row.currency] = bucket;
  }
  return { count: rows.length, totalEur, byCurrency };
}
