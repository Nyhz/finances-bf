import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  accounts,
  assetTransactions,
  dailyBalances,
  type Account,
} from "../db/schema";
import { listAccounts, getAccountsSummary } from "./accounts";
import { listPositions, getPositionsByAccount, type PositionRow } from "./positions";

export type OverviewRange = "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL";

export const OVERVIEW_RANGES: OverviewRange[] = [
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
  "ALL",
];

export type OverviewFilters = {
  accountId?: string | null;
  range: OverviewRange;
};

export type OverviewKpis = {
  totalNetWorthEur: number;
  cashEur: number;
  investedEur: number;
  unrealizedPnlEur: number;
  realizedPnlYtdEur: number | null;
};

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

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function resolveAccountIds(
  filters: OverviewFilters,
  db: DB,
): Promise<{ ids: string[]; accounts: Account[] }> {
  const all = await db.select().from(accounts).all();
  if (filters.accountId) {
    const match = all.filter((a) => a.id === filters.accountId);
    return { ids: match.map((a) => a.id), accounts: match };
  }
  return { ids: all.map((a) => a.id), accounts: all };
}

export async function getOverviewKpis(
  filters: OverviewFilters = { range: "ALL" },
  db: DB = defaultDb,
): Promise<OverviewKpis> {
  let cashEur = 0;
  if (filters.accountId) {
    const acc = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, filters.accountId))
      .get();
    cashEur = acc?.currentCashBalanceEur ?? 0;
  } else {
    const summary = await getAccountsSummary(db);
    cashEur = summary.totalEur;
  }

  const positions = filters.accountId
    ? await getPositionsByAccount(filters.accountId, db)
    : await listPositions(db);

  let investedEur = 0;
  let costBasisEur = 0;
  for (const row of positions) {
    if (row.valuationEur != null) investedEur += row.valuationEur;
    costBasisEur += row.position.quantity * row.position.averageCost;
  }

  let realizedPnlYtdEur: number | null = null;
  try {
    const { getRealizedGains } = await import("./taxes");
    const year = new Date().getUTCFullYear();
    const result = await getRealizedGains(year);
    realizedPnlYtdEur = result.totalRealizedEur;
  } catch {
    realizedPnlYtdEur = null;
  }

  return {
    totalNetWorthEur: cashEur + investedEur,
    cashEur,
    investedEur,
    unrealizedPnlEur: investedEur - costBasisEur,
    realizedPnlYtdEur,
  };
}

export type NetWorthPoint = {
  date: string;
  valueEur: number;
};

export async function getNetWorthSeries(
  filters: OverviewFilters,
  db: DB = defaultDb,
): Promise<NetWorthPoint[]> {
  const { ids } = await resolveAccountIds(filters, db);
  if (ids.length === 0) return [];

  const start = rangeStart(filters.range);
  const end = new Date();
  const conds = [
    inArray(dailyBalances.accountId, ids),
    lte(dailyBalances.balanceDate, toIsoDate(end)),
  ];
  if (start) conds.push(gte(dailyBalances.balanceDate, toIsoDate(start)));

  const rows = await db
    .select()
    .from(dailyBalances)
    .where(and(...conds))
    .orderBy(asc(dailyBalances.balanceDate))
    .all();

  const byDate = new Map<string, number>();
  for (const row of rows) {
    byDate.set(row.balanceDate, (byDate.get(row.balanceDate) ?? 0) + row.balanceEur);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, valueEur]) => ({ date, valueEur }));
}

export type TopPositionRow = {
  position: PositionRow;
  accountLabel: string;
  weight: number;
  pnlEur: number | null;
};

export async function getTopPositions(
  filters: OverviewFilters,
  limit: number,
  db: DB = defaultDb,
): Promise<TopPositionRow[]> {
  const positions = filters.accountId
    ? await getPositionsByAccount(filters.accountId, db)
    : await listPositions(db);

  const totalValue = positions.reduce(
    (acc, p) => acc + (p.valuationEur ?? 0),
    0,
  );

  const allAccounts = await listAccounts(db);
  const accountNameById = new Map(allAccounts.map((a) => [a.id, a.name]));

  const assetIds = positions.map((p) => p.position.assetId);
  const txAccountsByAsset = new Map<string, Set<string>>();
  if (assetIds.length > 0) {
    const txRows = await db
      .select({
        assetId: assetTransactions.assetId,
        accountId: assetTransactions.accountId,
      })
      .from(assetTransactions)
      .where(inArray(assetTransactions.assetId, assetIds))
      .all();
    for (const r of txRows) {
      const set = txAccountsByAsset.get(r.assetId) ?? new Set<string>();
      set.add(r.accountId);
      txAccountsByAsset.set(r.assetId, set);
    }
  }

  const enriched: TopPositionRow[] = positions.map((p) => {
    const accountIds = filters.accountId
      ? new Set([filters.accountId])
      : (txAccountsByAsset.get(p.position.assetId) ?? new Set<string>());
    const names = [...accountIds]
      .map((id) => accountNameById.get(id))
      .filter((n): n is string => Boolean(n));
    const accountLabel =
      names.length === 0
        ? "—"
        : names.length === 1
          ? names[0]
          : `${names.length} accounts`;
    const valuationEur = p.valuationEur ?? 0;
    const weight = totalValue > 0 ? valuationEur / totalValue : 0;
    const pnlEur =
      p.valuationEur == null
        ? null
        : p.valuationEur - p.position.quantity * p.position.averageCost;
    return { position: p, accountLabel, weight, pnlEur };
  });

  return enriched
    .filter((r) => r.position.position.quantity > 0)
    .sort((a, b) => (b.position.valuationEur ?? 0) - (a.position.valuationEur ?? 0))
    .slice(0, limit);
}

export type AllocationSlice = {
  assetClass: string;
  valueEur: number;
  weight: number;
};

export async function getAllocationByClass(
  filters: OverviewFilters,
  db: DB = defaultDb,
): Promise<AllocationSlice[]> {
  const positions = filters.accountId
    ? await getPositionsByAccount(filters.accountId, db)
    : await listPositions(db);

  const byClass = new Map<string, number>();
  for (const p of positions) {
    if (p.valuationEur == null || p.position.quantity <= 0) continue;
    const key = p.asset.assetType ?? "other";
    byClass.set(key, (byClass.get(key) ?? 0) + p.valuationEur);
  }
  const total = [...byClass.values()].reduce((a, b) => a + b, 0);
  return [...byClass.entries()]
    .map(([assetClass, valueEur]) => ({
      assetClass,
      valueEur,
      weight: total > 0 ? valueEur / total : 0,
    }))
    .sort((a, b) => b.valueEur - a.valueEur);
}

