import { and, asc, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import type { DB } from "../../db/client";
import {
  accounts,
  assetTransactions,
  assets,
  assetValuations,
  taxLotConsumptions,
  taxLots,
  taxWashSaleAdjustments,
} from "../../db/schema";

export type ConsumedLotSummary = {
  lotId: string;
  acquiredAt: number;
  qtyConsumed: number;
  costBasisEur: number;
};

export type SaleReportRow = {
  transactionId: string;
  tradedAt: number;
  accountId: string;
  assetId: string;
  quantity: number;
  proceedsEur: number;
  feesEur: number;
  costBasisEur: number;
  rawGainLossEur: number;
  nonComputableLossEur: number;
  computableGainLossEur: number;
  consumedLots: ConsumedLotSummary[];
  assetName: string | null;
  isin: string | null;
  assetClassTax: string | null;
};

export type DividendReportRow = {
  transactionId: string;
  tradedAt: number;
  accountId: string;
  assetId: string;
  assetName: string | null;
  isin: string | null;
  sourceCountry: string | null;
  grossNative: number;
  grossEur: number;
  withholdingOrigenEur: number;
  withholdingDestinoEur: number;
  netEur: number;
};

export type YearEndBalance = {
  accountId: string;
  accountName: string | null;
  accountCountry: string | null;
  accountType: string;
  assetId: string;
  assetName: string | null;
  isin: string | null;
  assetClassTax: string | null;
  quantity: number;
  valueEur: number;
};

export type TaxReport = {
  year: number;
  sales: SaleReportRow[];
  dividends: DividendReportRow[];
  yearEndBalances: YearEndBalance[];
  totals: {
    realizedGainsEur: number;
    realizedLossesComputableEur: number;
    nonComputableLossesEur: number;
    netComputableEur: number;
    proceedsEur: number;
    costBasisEur: number;
    feesEur: number;
    dividendsGrossEur: number;
    withholdingOrigenTotalEur: number;
    withholdingDestinoTotalEur: number;
  };
};

// Dust threshold: disposals where both proceeds and cost basis are below €1 are
// excluded from the tax report. Typical source: crypto exchange fees paid in
// the asset itself (Binance BNB fee deductions create tiny "sells"). Hacienda
// would technically count these as disposals (DGT V1069-19) but the tax impact
// is essentially zero and they drown out meaningful sales in the report.
export const DUST_THRESHOLD_EUR = 1;

function yearBounds(year: number): { start: number; end: number } {
  return { start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1) };
}

export function buildTaxReport(db: DB, year: number): TaxReport {
  const { start, end } = yearBounds(year);

  const sellRows = db
    .select()
    .from(assetTransactions)
    .where(
      and(
        eq(assetTransactions.transactionType, "sell"),
        gte(assetTransactions.tradedAt, start),
        lt(assetTransactions.tradedAt, end),
      ),
    )
    .orderBy(asc(assetTransactions.tradedAt))
    .all();

  const sales: SaleReportRow[] = [];

  for (const row of sellRows) {
    const consumptions = db
      .select()
      .from(taxLotConsumptions)
      .where(eq(taxLotConsumptions.saleTransactionId, row.id))
      .all();

    const lotIds = consumptions.map((c) => c.lotId);
    const lotRows = lotIds.length
      ? db.select().from(taxLots).where(inArray(taxLots.id, lotIds)).all()
      : [];
    const lotById = new Map(lotRows.map((l) => [l.id, l]));

    const costBasisEur = consumptions.reduce((s, c) => s + c.costBasisEur, 0);
    const rawGainLoss = row.tradeGrossAmountEur - costBasisEur - row.feesAmountEur;

    const adjustments = db
      .select()
      .from(taxWashSaleAdjustments)
      .where(eq(taxWashSaleAdjustments.saleTransactionId, row.id))
      .all();
    const nonComputable = adjustments.reduce((s, a) => s + a.disallowedLossEur, 0);
    // Disallowed loss reduces the magnitude of the loss (raw −200, disallowed 60 → computable −140).
    const computable = rawGainLoss < 0 ? rawGainLoss + nonComputable : rawGainLoss;

    const asset = db.select().from(assets).where(eq(assets.id, row.assetId)).get();

    sales.push({
      transactionId: row.id,
      tradedAt: row.tradedAt,
      accountId: row.accountId,
      assetId: row.assetId,
      quantity: row.quantity,
      proceedsEur: row.tradeGrossAmountEur,
      feesEur: row.feesAmountEur,
      costBasisEur,
      rawGainLossEur: rawGainLoss,
      nonComputableLossEur: nonComputable,
      computableGainLossEur: computable,
      consumedLots: consumptions.map((c) => ({
        lotId: c.lotId,
        acquiredAt: lotById.get(c.lotId)?.acquiredAt ?? 0,
        qtyConsumed: c.qtyConsumed,
        costBasisEur: c.costBasisEur,
      })),
      assetName: asset?.name ?? null,
      isin: asset?.isin ?? null,
      assetClassTax: asset?.assetClassTax ?? null,
    });
  }

  const visibleSales = sales
    .filter(
      (s) =>
        Math.abs(s.proceedsEur) >= DUST_THRESHOLD_EUR ||
        Math.abs(s.costBasisEur) >= DUST_THRESHOLD_EUR,
    )
    .sort((a, b) => a.tradedAt - b.tradedAt);

  const dividendRows = db
    .select()
    .from(assetTransactions)
    .where(
      and(
        eq(assetTransactions.transactionType, "dividend"),
        gte(assetTransactions.tradedAt, start),
        lt(assetTransactions.tradedAt, end),
      ),
    )
    .orderBy(asc(assetTransactions.tradedAt))
    .all();

  const dividends: DividendReportRow[] = dividendRows.map((row) => {
    const asset = db.select().from(assets).where(eq(assets.id, row.assetId)).get();
    return {
      transactionId: row.id,
      tradedAt: row.tradedAt,
      accountId: row.accountId,
      assetId: row.assetId,
      assetName: asset?.name ?? null,
      isin: asset?.isin ?? null,
      sourceCountry: row.sourceCountry,
      grossNative: row.dividendGross ?? row.tradeGrossAmount,
      grossEur: row.tradeGrossAmountEur,
      withholdingOrigenEur: row.withholdingTax ?? 0,
      withholdingDestinoEur: row.withholdingTaxDestination ?? 0,
      netEur: row.cashImpactEur,
    };
  });

  let realizedGainsEur = 0;
  let realizedLossesComputableEur = 0;
  let nonComputableLossesEur = 0;
  let proceedsEur = 0;
  let costBasisEur = 0;
  let feesEur = 0;
  for (const s of visibleSales) {
    if (s.computableGainLossEur >= 0) realizedGainsEur += s.computableGainLossEur;
    else realizedLossesComputableEur += s.computableGainLossEur;
    nonComputableLossesEur += s.nonComputableLossEur;
    proceedsEur += s.proceedsEur;
    costBasisEur += s.costBasisEur;
    feesEur += s.feesEur;
  }

  let dividendsGrossEur = 0;
  let withholdingOrigenTotalEur = 0;
  let withholdingDestinoTotalEur = 0;
  for (const d of dividends) {
    dividendsGrossEur += d.grossEur;
    withholdingOrigenTotalEur += d.withholdingOrigenEur;
    withholdingDestinoTotalEur += d.withholdingDestinoEur;
  }

  const yearEndIso = new Date(end - 86_400_000).toISOString().slice(0, 10);
  const allLotRows = db.select().from(taxLots).all();
  const byKey = new Map<string, { accountId: string; assetId: string; qty: number }>();
  for (const lot of allLotRows) {
    if (lot.remainingQty <= 1e-9) continue;
    if (lot.acquiredAt >= end) continue; // lot acquired after year-end
    const key = `${lot.accountId}::${lot.assetId}`;
    const cur = byKey.get(key) ?? { accountId: lot.accountId, assetId: lot.assetId, qty: 0 };
    cur.qty += lot.remainingQty;
    byKey.set(key, cur);
  }
  const yearEndBalances: YearEndBalance[] = [];
  for (const entry of byKey.values()) {
    const account = db.select().from(accounts).where(eq(accounts.id, entry.accountId)).get();
    const asset = db.select().from(assets).where(eq(assets.id, entry.assetId)).get();
    const valuation = db
      .select()
      .from(assetValuations)
      .where(and(eq(assetValuations.assetId, entry.assetId), lte(assetValuations.valuationDate, yearEndIso)))
      .orderBy(desc(assetValuations.valuationDate))
      .limit(1)
      .get();
    const valueEur = valuation ? entry.qty * valuation.unitPriceEur : 0;
    yearEndBalances.push({
      accountId: entry.accountId,
      accountName: account?.name ?? null,
      accountCountry: account?.countryCode ?? null,
      accountType: account?.accountType ?? "unknown",
      assetId: entry.assetId,
      assetName: asset?.name ?? null,
      isin: asset?.isin ?? null,
      assetClassTax: asset?.assetClassTax ?? null,
      quantity: entry.qty,
      valueEur,
    });
  }

  return {
    year,
    sales: visibleSales,
    dividends,
    yearEndBalances,
    totals: {
      realizedGainsEur,
      realizedLossesComputableEur,
      nonComputableLossesEur,
      netComputableEur: realizedGainsEur + realizedLossesComputableEur,
      proceedsEur,
      costBasisEur,
      feesEur,
      dividendsGrossEur,
      withholdingOrigenTotalEur,
      withholdingDestinoTotalEur,
    },
  };
}
