import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  accounts,
  type AccountCashMovement,
} from "../db/schema";
import type { OverviewRange } from "./overview";
import { toIsoDate } from "../lib/time";

function rangeStart(range: OverviewRange, now: Date = new Date()): Date | null {
  if (range === "ALL") return null;
  const d = new Date(now);
  if (range === "YTD") return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  if (range === "1M") d.setUTCMonth(d.getUTCMonth() - 1);
  else if (range === "3M") d.setUTCMonth(d.getUTCMonth() - 3);
  else if (range === "6M") d.setUTCMonth(d.getUTCMonth() - 6);
  else if (range === "1Y") d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d;
}

export type SavingsKpis = {
  balanceEur: number;
  depositsEur: number;
  withdrawalsEur: number;
  interestEur: number;
  feesEur: number;
  netChangeEur: number;
};

export async function getSavingsKpis(
  accountId: string,
  range: OverviewRange,
  db: DB = defaultDb,
): Promise<SavingsKpis> {
  const account = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get();
  if (!account) {
    return {
      balanceEur: 0,
      depositsEur: 0,
      withdrawalsEur: 0,
      interestEur: 0,
      feesEur: 0,
      netChangeEur: 0,
    };
  }
  const start = rangeStart(range);
  const conds = [eq(accountCashMovements.accountId, accountId)];
  if (start) conds.push(gte(accountCashMovements.occurredAt, start.getTime()));
  const movements = await db
    .select()
    .from(accountCashMovements)
    .where(and(...conds))
    .all();

  let depositsEur = 0;
  let withdrawalsEur = 0;
  let interestEur = 0;
  let feesEur = 0;
  let netChangeEur = 0;
  for (const m of movements) {
    netChangeEur += m.cashImpactEur;
    if (m.movementType === "deposit") depositsEur += m.cashImpactEur;
    else if (m.movementType === "withdrawal") withdrawalsEur += m.cashImpactEur;
    else if (m.movementType === "interest") interestEur += m.cashImpactEur;
    else if (m.movementType === "fee") feesEur += m.cashImpactEur;
  }

  return {
    balanceEur: account.currentCashBalanceEur,
    depositsEur,
    withdrawalsEur,
    interestEur,
    feesEur,
    netChangeEur,
  };
}

export type SavingsBalancePoint = {
  date: string;
  balanceEur: number;
};

/**
 * End-of-day balance series. Includes one synthetic carry-forward point at
 * the range start (the balance *before* any in-range movement) so the chart
 * has a baseline even when the first movement inside the range is far from
 * the start.
 */
export async function getSavingsBalanceSeries(
  accountId: string,
  range: OverviewRange,
  db: DB = defaultDb,
): Promise<SavingsBalancePoint[]> {
  const account = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get();
  if (!account) return [];

  const all = await db
    .select()
    .from(accountCashMovements)
    .where(eq(accountCashMovements.accountId, accountId))
    .orderBy(asc(accountCashMovements.occurredAt))
    .all();

  const startDate = rangeStart(range);
  const startIso = startDate ? toIsoDate(startDate) : null;
  const todayIso = toIsoDate(new Date());

  // Walk all movements, maintain a running end-of-day balance.
  let running = account.openingBalanceEur;
  const inRange: SavingsBalancePoint[] = [];
  let runningAtStart = running;
  for (const m of all) {
    running += m.cashImpactEur;
    const iso = toIsoDate(new Date(m.occurredAt));
    if (startIso && iso < startIso) {
      runningAtStart = running;
      continue;
    }
    if (inRange.length > 0 && inRange[inRange.length - 1].date === iso) {
      // Overwrite same-day point with the later balance.
      inRange[inRange.length - 1].balanceEur = running;
    } else {
      inRange.push({ date: iso, balanceEur: running });
    }
  }

  // Prepend a synthetic baseline at range start if there are earlier movements
  // than the range covers, so the chart starts from a known balance rather
  // than jumping from zero.
  if (startIso && (inRange.length === 0 || inRange[0].date !== startIso)) {
    inRange.unshift({ date: startIso, balanceEur: runningAtStart });
  }

  // Always pin a point at today so the chart ends at the current balance even
  // if nothing happened recently.
  if (inRange.length > 0 && inRange[inRange.length - 1].date !== todayIso) {
    inRange.push({
      date: todayIso,
      balanceEur: inRange[inRange.length - 1].balanceEur,
    });
  }
  if (inRange.length === 0) {
    inRange.push({ date: todayIso, balanceEur: account.currentCashBalanceEur });
  }
  return inRange;
}

export async function getSavingsMovements(
  accountId: string,
  range: OverviewRange,
  limit: number,
  db: DB = defaultDb,
): Promise<AccountCashMovement[]> {
  const start = rangeStart(range);
  const end = new Date();
  const conds = [eq(accountCashMovements.accountId, accountId)];
  if (start) conds.push(gte(accountCashMovements.occurredAt, start.getTime()));
  conds.push(lte(accountCashMovements.occurredAt, end.getTime()));
  return db
    .select()
    .from(accountCashMovements)
    .where(and(...conds))
    .orderBy(desc(accountCashMovements.occurredAt))
    .limit(limit)
    .all();
}
