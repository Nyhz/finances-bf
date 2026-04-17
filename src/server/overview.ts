import { db as defaultDb, type DB } from "../db/client";
import { getAccountsSummary } from "./accounts";
import { listPositions } from "./positions";

export type OverviewKpis = {
  totalNetWorthEur: number;
  cashEur: number;
  investedEur: number;
  unrealizedPnlEur: number;
};

export async function getOverviewKpis(db: DB = defaultDb): Promise<OverviewKpis> {
  const summary = await getAccountsSummary(db);
  const positions = await listPositions(db);

  const cashEur = summary.totalEur;
  let investedEur = 0;
  let costBasisEur = 0;
  for (const row of positions) {
    if (row.valuationEur != null) investedEur += row.valuationEur;
    costBasisEur += row.position.quantity * row.position.averageCost;
  }

  return {
    totalNetWorthEur: cashEur + investedEur,
    cashEur,
    investedEur,
    unrealizedPnlEur: investedEur - costBasisEur,
  };
}

export type PerformancePoint = {
  date: string;
  valueEur: number;
};

// Stub — Phase 4 renders a placeholder. Populated by a later mission once
// daily_balances + asset_valuations have a materialized timeseries.
export async function getPerformanceSeries(): Promise<PerformancePoint[]> {
  return [];
}
