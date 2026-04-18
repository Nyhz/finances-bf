import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  accounts,
  assetTransactions,
  assetValuations,
  type Account,
} from "../db/schema";
import { listAccounts, getAccountsSummary } from "./accounts";
import { isCashBearingAccount } from "../actions/_shared";
import { listPositions, type PositionRow } from "./positions";

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
  /** Empty array or null means "all accounts". */
  accountIds?: string[] | null;
  range: OverviewRange;
};

export type OverviewKpis = {
  totalNetWorthEur: number;
  cashEur: number;
  investedEur: number;
  unrealizedPnlEur: number;
  unrealizedPnlPct: number | null;
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
  const wanted = filters.accountIds && filters.accountIds.length > 0
    ? new Set(filters.accountIds)
    : null;
  if (wanted) {
    const match = all.filter((a) => wanted.has(a.id));
    return { ids: match.map((a) => a.id), accounts: match };
  }
  return { ids: all.map((a) => a.id), accounts: all };
}

async function assetIdsForAccounts(
  accountIds: string[],
  db: DB,
): Promise<Set<string>> {
  if (accountIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ assetId: assetTransactions.assetId })
    .from(assetTransactions)
    .where(inArray(assetTransactions.accountId, accountIds))
    .all();
  return new Set(rows.map((r) => r.assetId));
}

export async function getOverviewKpis(
  filters: OverviewFilters = { range: "ALL" },
  db: DB = defaultDb,
): Promise<OverviewKpis> {
  const { accounts: filteredAccounts, ids: filteredAccountIds } =
    await resolveAccountIds(filters, db);
  const filteringAccounts = filters.accountIds != null && filters.accountIds.length > 0;

  let cashEur = 0;
  if (filteringAccounts) {
    cashEur = filteredAccounts
      .filter((a) => isCashBearingAccount(a.accountType))
      .reduce((s, a) => s + a.currentCashBalanceEur, 0);
  } else {
    const summary = await getAccountsSummary(db);
    cashEur = summary.totalEur;
  }

  let positions = await listPositions(db);
  if (filteringAccounts) {
    const assetIds = await assetIdsForAccounts(filteredAccountIds, db);
    positions = positions.filter((p) => assetIds.has(p.position.assetId));
  }

  let marketValueEur = 0;
  let investedEur = 0;
  for (const row of positions) {
    if (row.valuationEur != null) marketValueEur += row.valuationEur;
    investedEur += row.position.quantity * row.position.averageCost;
  }

  // Range-aware P/L across the filtered positions. For ALL, this reduces to
  // marketValue - costBasis. For a time range we subtract any contributions
  // (buys/sells) that happened inside the window so the pct reflects pure
  // market movement rather than cash inflow/outflow.
  let unrealizedPnlEur = marketValueEur - investedEur;
  let pctBase = investedEur;
  if (filters.range !== "ALL" && positions.length > 0) {
    const scopeAssetIds = positions.map((p) => p.position.assetId);
    const rangeStartDate = rangeStart(filters.range);
    const startIsoKpi = rangeStartDate ? toIsoDate(rangeStartDate) : null;
    const startMsKpi = rangeStartDate ? rangeStartDate.getTime() : null;

    // Value on range-start day (nearest <= start). If the position didn't
    // exist before the range, start value is 0 — otherwise we'd double-count
    // the opening buy (once as starting value, once as a contribution).
    let startValueTotal = 0;
    if (startIsoKpi) {
      for (const assetId of scopeAssetIds) {
        const onOrBefore = await db
          .select()
          .from(assetValuations)
          .where(
            and(
              eq(assetValuations.assetId, assetId),
              lte(assetValuations.valuationDate, startIsoKpi),
            ),
          )
          .orderBy(desc(assetValuations.valuationDate))
          .limit(1)
          .get();
        if (onOrBefore) startValueTotal += onOrBefore.marketValueEur;
      }
    }

    // Net contributions during the range: Σ -cashImpactEur for trades
    // belonging to the scope.
    let contributionsInRange = 0;
    if (startMsKpi !== null) {
      const txs = await db
        .select({
          assetId: assetTransactions.assetId,
          accountId: assetTransactions.accountId,
          tradedAt: assetTransactions.tradedAt,
          cashImpactEur: assetTransactions.cashImpactEur,
        })
        .from(assetTransactions)
        .where(inArray(assetTransactions.assetId, scopeAssetIds))
        .all();
      const accountFilter = filteringAccounts ? new Set(filteredAccountIds) : null;
      for (const t of txs) {
        if (t.tradedAt < startMsKpi) continue;
        if (accountFilter && !accountFilter.has(t.accountId)) continue;
        contributionsInRange -= t.cashImpactEur;
      }
    }

    unrealizedPnlEur = marketValueEur - startValueTotal - contributionsInRange;
    pctBase = startValueTotal + Math.max(contributionsInRange, 0);
  }

  let realizedPnlYtdEur: number | null = null;
  try {
    const { computeRealizedGainsForYear } = await import("./taxes");
    const year = new Date().getUTCFullYear();
    const result = await computeRealizedGainsForYear(year);
    realizedPnlYtdEur = result.totals.netRealizedEur;
  } catch {
    realizedPnlYtdEur = null;
  }

  const unrealizedPnlPct = pctBase > 0 ? unrealizedPnlEur / pctBase : null;
  return {
    totalNetWorthEur: cashEur + marketValueEur,
    cashEur,
    investedEur,
    unrealizedPnlEur,
    unrealizedPnlPct,
    realizedPnlYtdEur,
  };
}

export type NetWorthPoint = {
  date: string;
  valueEur: number;
  /** Cumulative EUR contributed into scope up to and including this date.
   *  Used to compute a P/L % that excludes fresh deposits. */
  investedEur: number;
};

export async function getNetWorthSeries(
  filters: OverviewFilters,
  db: DB = defaultDb,
): Promise<NetWorthPoint[]> {
  const { ids } = await resolveAccountIds(filters, db);
  if (ids.length === 0) return [];

  const start = rangeStart(filters.range);
  const end = new Date();
  const filteringAccounts =
    filters.accountIds != null && filters.accountIds.length > 0;

  const conds = [lte(assetValuations.valuationDate, toIsoDate(end))];
  if (start) conds.push(gte(assetValuations.valuationDate, toIsoDate(start)));
  if (filteringAccounts) {
    const scopeAssetIds = await assetIdsForAccounts(filters.accountIds!, db);
    if (scopeAssetIds.size === 0) return [];
    conds.push(inArray(assetValuations.assetId, [...scopeAssetIds]));
  }

  const rows = await db
    .select()
    .from(assetValuations)
    .where(and(...conds))
    .orderBy(asc(assetValuations.valuationDate))
    .all();

  const byDate = new Map<string, number>();
  for (const row of rows) {
    byDate.set(
      row.valuationDate,
      (byDate.get(row.valuationDate) ?? 0) + row.marketValueEur,
    );
  }

  // Cumulative invested EUR per date. Invested_t = cost_basis_bought_up_to_t
  // - cost_basis_realised_from_sells_up_to_t. For simplicity we sum the
  // positive part of each trade's cash impact (buys = outflow = -cashImpact).
  const txConds = [];
  if (filteringAccounts) {
    txConds.push(inArray(assetTransactions.accountId, filters.accountIds!));
  }
  const txs = await db
    .select({
      tradedAt: assetTransactions.tradedAt,
      cashImpactEur: assetTransactions.cashImpactEur,
    })
    .from(assetTransactions)
    .where(txConds.length > 0 ? and(...txConds) : undefined)
    .orderBy(asc(assetTransactions.tradedAt))
    .all();
  // Date-keyed net-contribution delta (-cashImpact sums to positive for buys).
  const deltaByDate = new Map<string, number>();
  for (const t of txs) {
    const iso = toIsoDate(new Date(t.tradedAt));
    deltaByDate.set(iso, (deltaByDate.get(iso) ?? 0) - t.cashImpactEur);
  }

  const sortedDates = [...byDate.keys()].sort();
  let invested = 0;
  // Roll contributions that happened BEFORE our first date into the initial
  // invested baseline (otherwise we'd start the curve already below breakeven).
  if (sortedDates.length > 0) {
    const first = sortedDates[0];
    for (const [iso, delta] of deltaByDate) {
      if (iso < first) invested += delta;
    }
  }
  const out: NetWorthPoint[] = [];
  for (const date of sortedDates) {
    invested += deltaByDate.get(date) ?? 0;
    out.push({
      date,
      valueEur: byDate.get(date) ?? 0,
      investedEur: invested,
    });
  }
  return out;
}

export type TopPositionRow = {
  position: PositionRow;
  accountLabel: string;
  weight: number;
  pnlEur: number | null;
  pnlPct: number | null;
  unitPriceEur: number | null;
  averageCostEur: number;
  sparkline: Array<{ date: string; valueEur: number; investedEur: number }>;
};

export async function getTopPositions(
  filters: OverviewFilters,
  limit: number,
  db: DB = defaultDb,
): Promise<TopPositionRow[]> {
  const filteringAccounts = filters.accountIds != null && filters.accountIds.length > 0;
  let positions = await listPositions(db);
  if (filteringAccounts) {
    const assetIdsInScope = await assetIdsForAccounts(filters.accountIds!, db);
    positions = positions.filter((p) => assetIdsInScope.has(p.position.assetId));
  }

  const totalValue = positions.reduce(
    (acc, p) => acc + (p.valuationEur ?? 0),
    0,
  );

  const allAccounts = await listAccounts(db);
  const accountNameById = new Map(allAccounts.map((a) => [a.id, a.name]));

  const assetIds = positions.map((p) => p.position.assetId);
  const txAccountsByAsset = new Map<string, Set<string>>();
  const contribsInRangeByAsset = new Map<string, number>();
  // Per-asset map: ISO date → Σ -cashImpactEur of trades on that date.
  const contribDeltasByAsset = new Map<string, Map<string, number>>();
  // Per-asset: Σ -cashImpactEur of trades dated BEFORE the range start.
  const investedBeforeRangeByAsset = new Map<string, number>();

  // Bulk-load valuations within the range for sparkline + range P/L.
  const start = rangeStart(filters.range);
  const startIso = start ? toIsoDate(start) : null;
  const todayIso = toIsoDate(new Date());
  const startMs = start ? start.getTime() : null;

  if (assetIds.length > 0) {
    const txRows = await db
      .select({
        assetId: assetTransactions.assetId,
        accountId: assetTransactions.accountId,
        tradedAt: assetTransactions.tradedAt,
        cashImpactEur: assetTransactions.cashImpactEur,
      })
      .from(assetTransactions)
      .where(inArray(assetTransactions.assetId, assetIds))
      .all();
    for (const r of txRows) {
      const set = txAccountsByAsset.get(r.assetId) ?? new Set<string>();
      set.add(r.accountId);
      txAccountsByAsset.set(r.assetId, set);
      if (startMs !== null && r.tradedAt >= startMs) {
        contribsInRangeByAsset.set(
          r.assetId,
          (contribsInRangeByAsset.get(r.assetId) ?? 0) - r.cashImpactEur,
        );
      }
      // Accumulate per-day deltas and pre-range running invested.
      const tradedIso = toIsoDate(new Date(r.tradedAt));
      const deltas =
        contribDeltasByAsset.get(r.assetId) ?? new Map<string, number>();
      deltas.set(tradedIso, (deltas.get(tradedIso) ?? 0) - r.cashImpactEur);
      contribDeltasByAsset.set(r.assetId, deltas);
      if (startIso && tradedIso < startIso) {
        investedBeforeRangeByAsset.set(
          r.assetId,
          (investedBeforeRangeByAsset.get(r.assetId) ?? 0) - r.cashImpactEur,
        );
      }
    }
  }

  // Per-asset start value (nearest valuation <= startIso). If a position
  // didn't exist yet before the range began, start value is 0.
  const startValueByAsset = new Map<string, number>();
  if (startIso && assetIds.length > 0) {
    for (const assetId of assetIds) {
      const before = await db
        .select()
        .from(assetValuations)
        .where(
          and(
            eq(assetValuations.assetId, assetId),
            lte(assetValuations.valuationDate, startIso),
          ),
        )
        .orderBy(desc(assetValuations.valuationDate))
        .limit(1)
        .get();
      if (before) startValueByAsset.set(assetId, before.marketValueEur);
    }
  }

  const valuationsByAsset = new Map<
    string,
    Array<{ date: string; valueEur: number; investedEur: number }>
  >();
  if (assetIds.length > 0) {
    const conds = [
      inArray(assetValuations.assetId, assetIds),
      lte(assetValuations.valuationDate, todayIso),
    ];
    if (startIso) conds.push(gte(assetValuations.valuationDate, startIso));
    const vRows = await db
      .select()
      .from(assetValuations)
      .where(and(...conds))
      .orderBy(asc(assetValuations.valuationDate))
      .all();
    // Per-asset running invested: starts at the pre-range cumulative, and
    // picks up trade-day deltas as we walk ordered valuations.
    const runningInvestedByAsset = new Map<string, number>();
    for (const assetId of assetIds) {
      runningInvestedByAsset.set(
        assetId,
        investedBeforeRangeByAsset.get(assetId) ?? 0,
      );
    }
    for (const v of vRows) {
      const deltas = contribDeltasByAsset.get(v.assetId);
      if (deltas && deltas.has(v.valuationDate)) {
        runningInvestedByAsset.set(
          v.assetId,
          (runningInvestedByAsset.get(v.assetId) ?? 0) +
            (deltas.get(v.valuationDate) ?? 0),
        );
      }
      const list = valuationsByAsset.get(v.assetId) ?? [];
      list.push({
        date: v.valuationDate,
        valueEur: v.marketValueEur,
        investedEur: runningInvestedByAsset.get(v.assetId) ?? 0,
      });
      valuationsByAsset.set(v.assetId, list);
    }
  }

  const selectedSet = filteringAccounts ? new Set(filters.accountIds!) : null;

  const enriched: TopPositionRow[] = positions.map((p) => {
    const assetAccounts =
      txAccountsByAsset.get(p.position.assetId) ?? new Set<string>();
    const accountIds = selectedSet
      ? new Set([...assetAccounts].filter((id) => selectedSet.has(id)))
      : assetAccounts;
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
    const costBasisEur = p.position.quantity * p.position.averageCost;
    const sparkline = valuationsByAsset.get(p.position.assetId) ?? [];

    let pnlEur: number | null = null;
    let pnlPct: number | null = null;
    if (p.valuationEur != null) {
      if (filters.range === "ALL") {
        pnlEur = p.valuationEur - costBasisEur;
        pnlPct = costBasisEur > 0 ? pnlEur / costBasisEur : null;
      } else {
        const startValue = startValueByAsset.get(p.position.assetId) ?? 0;
        const contributions =
          contribsInRangeByAsset.get(p.position.assetId) ?? 0;
        pnlEur = p.valuationEur - startValue - contributions;
        const base = startValue + Math.max(contributions, 0);
        pnlPct = base > 0 ? pnlEur / base : null;
      }
    }

    return {
      position: p,
      accountLabel,
      weight,
      pnlEur,
      pnlPct,
      unitPriceEur: p.valuation?.unitPriceEur ?? null,
      averageCostEur: p.position.averageCost,
      sparkline,
    };
  });

  return enriched
    .filter((r) => r.position.position.quantity > 0)
    .sort((a, b) => (b.position.valuationEur ?? 0) - (a.position.valuationEur ?? 0))
    .slice(0, limit);
}


