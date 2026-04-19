import { db as defaultDb, type DB } from "../db/client";
import { accountCashMovements, assetTransactions } from "../db/schema";
import { buildTaxReport } from "./tax/report";

export async function getTaxYears(db: DB = defaultDb): Promise<number[]> {
  const rows = await db.select({ tradedAt: assetTransactions.tradedAt }).from(assetTransactions).all();
  const cashRows = await db.select({ occurredAt: accountCashMovements.occurredAt }).from(accountCashMovements).all();
  const years = new Set<number>();
  for (const r of rows) years.add(new Date(r.tradedAt).getUTCFullYear());
  for (const r of cashRows) years.add(new Date(r.occurredAt).getUTCFullYear());
  return [...years].sort((a, b) => b - a);
}

export type RealizedSale = {
  saleId: string;
  sellDate: number;
  accountId: string;
  accountName: string | null;
  assetId: string;
  assetName: string | null;
  quantity: number;
  proceedsEur: number;
  costBasisEur: number;
  feesEur: number;
  realizedGainEur: number;
};

export type RealizedGainsYearResult = {
  sales: RealizedSale[];
  totals: {
    realizedGainsEur: number;
    realizedLossesEur: number;
    netRealizedEur: number;
    proceedsEur: number;
    costBasisEur: number;
    feesEur: number;
  };
};

export async function computeRealizedGainsForYear(
  year: number,
  db: DB = defaultDb,
): Promise<RealizedGainsYearResult> {
  const report = buildTaxReport(db, year);
  const sales: RealizedSale[] = report.sales.map((s) => ({
    saleId: s.transactionId,
    sellDate: s.tradedAt,
    accountId: s.accountId,
    accountName: null,
    assetId: s.assetId,
    assetName: s.assetName,
    quantity: s.quantity,
    proceedsEur: s.proceedsEur,
    costBasisEur: s.costBasisEur,
    feesEur: s.feesEur,
    realizedGainEur: s.computableGainLossEur,
  }));
  return {
    sales,
    totals: {
      realizedGainsEur: report.totals.realizedGainsEur,
      realizedLossesEur: report.totals.realizedLossesComputableEur,
      netRealizedEur: report.totals.netComputableEur,
      proceedsEur: report.totals.proceedsEur,
      costBasisEur: report.totals.costBasisEur,
      feesEur: report.totals.feesEur,
    },
  };
}

export type DividendInterestYearResult = {
  dividendsEur: number;
  interestEur: number;
  totalEur: number;
};

export async function computeDividendAndInterestForYear(
  year: number,
  db: DB = defaultDb,
): Promise<DividendInterestYearResult> {
  const report = buildTaxReport(db, year);
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const rows = await db.select().from(accountCashMovements).all();
  let interestEur = 0;
  for (const r of rows) {
    if (r.occurredAt < start || r.occurredAt >= end) continue;
    if (r.movementType === "interest") interestEur += r.cashImpactEur;
  }
  return {
    dividendsEur: report.totals.dividendsGrossEur,
    interestEur,
    totalEur: report.totals.dividendsGrossEur + interestEur,
  };
}
