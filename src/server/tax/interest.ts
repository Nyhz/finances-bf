import { and, eq, gte, lt } from "drizzle-orm";
import { db as defaultDb, type DB } from "../../db/client";
import { accountCashMovements } from "../../db/schema";

export async function getInterestForYear(year: number, db: DB = defaultDb): Promise<number> {
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const rows = await db
    .select()
    .from(accountCashMovements)
    .where(
      and(
        eq(accountCashMovements.movementType, "interest"),
        gte(accountCashMovements.occurredAt, start),
        lt(accountCashMovements.occurredAt, end),
      ),
    )
    .all();
  return rows.reduce((s, r) => s + r.cashImpactEur, 0);
}
