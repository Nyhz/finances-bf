import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { roundEur } from "../../lib/money";
import { txEur, type TxEur } from "../../lib/money-types";
import type { DB } from "../../db/client";
import {
  assetTransactions,
  assets,
  taxLotConsumptions,
  taxLots,
  taxWashSaleAdjustments,
} from "../../db/schema";
import { buildYearEndBalances, type YearEndBalance } from "./yearEnd";

// Re-exported so existing consumers keep importing from "./report".
export { YEAR_END_VALUATION_STALE_DAYS } from "./yearEnd";
export type { YearEndBalance } from "./yearEnd";

export type ConsumedLotSummary = {
  lotId: string;
  acquiredAt: number;
  qtyConsumed: number;
  costBasisEur: TxEur;
};

export type SaleReportRow = {
  transactionId: string;
  /** "market-fx" when the EUR legs were valued from a market daily close
   *  (Binance crypto-crypto permuta) rather than user/broker-entered data. */
  valuationBasis: string | null;
  tradedAt: number;
  accountId: string;
  assetId: string;
  quantity: number;
  proceedsEur: TxEur;
  feesEur: TxEur;
  costBasisEur: TxEur;
  rawGainLossEur: TxEur;
  nonComputableLossEur: TxEur;
  computableGainLossEur: TxEur;
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
  grossEur: TxEur;
  withholdingOrigenEur: TxEur;
  withholdingDestinoEur: TxEur;
  netEur: TxEur;
};


export type TaxReport = {
  year: number;
  sales: SaleReportRow[];
  dividends: DividendReportRow[];
  yearEndBalances: YearEndBalance[];
  /** Disposals dropped by the dust filter (audit T7) — disclosed, never silent.
   *  Optional: snapshots sealed before this field existed lack it. */
  excludedSales?: { count: number; proceedsEur: TxEur; costBasisEur: TxEur };
  totals: {
    realizedGainsEur: TxEur;
    realizedLossesComputableEur: TxEur;
    nonComputableLossesEur: TxEur;
    netComputableEur: TxEur;
    proceedsEur: TxEur;
    costBasisEur: TxEur;
    feesEur: TxEur;
    dividendsGrossEur: TxEur;
    withholdingOrigenTotalEur: TxEur;
    withholdingDestinoTotalEur: TxEur;
  };
};

// Dust threshold: disposals where both proceeds and cost basis are below €1 are
// excluded from the tax report. Typical source: crypto exchange fees paid in
// the asset itself (Binance BNB fee deductions create tiny "sells"). Hacienda
// would technically count these as disposals (DGT V1069-19) but the tax impact
// is essentially zero and they drown out meaningful sales in the report.
// Rows with exactly €0 proceeds are always excluded — those are import artifacts
// (fees paid in BNB etc.) that the importer failed to assign an EUR value to,
// not real disposals intentionally made by the user.
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

  const assetIdSet = [...new Set(
    db
      .select({ assetId: assetTransactions.assetId })
      .from(assetTransactions)
      .where(and(gte(assetTransactions.tradedAt, start), lt(assetTransactions.tradedAt, end)))
      .all()
      .map((r) => r.assetId),
  )];
  const assetById = new Map(
    (assetIdSet.length
      ? db.select().from(assets).where(inArray(assets.id, assetIdSet)).all()
      : []
    ).map((a) => [a.id, a]),
  );

  const sales: SaleReportRow[] = [];

  // Audit P2: one query per table for the whole year instead of 3-4 queries
  // per sale row.
  const sellIds = sellRows.map((r) => r.id);
  const allConsumptions = sellIds.length
    ? db.select().from(taxLotConsumptions).where(inArray(taxLotConsumptions.saleTransactionId, sellIds)).all()
    : [];
  const consumptionsBySale = new Map<string, typeof allConsumptions>();
  for (const c of allConsumptions) {
    const list = consumptionsBySale.get(c.saleTransactionId) ?? [];
    list.push(c);
    consumptionsBySale.set(c.saleTransactionId, list);
  }
  const allLotIds = [...new Set(allConsumptions.map((c) => c.lotId))];
  const lotById = new Map(
    (allLotIds.length
      ? db.select().from(taxLots).where(inArray(taxLots.id, allLotIds)).all()
      : []
    ).map((l) => [l.id, l]),
  );
  const allAdjustments = sellIds.length
    ? db.select().from(taxWashSaleAdjustments).where(inArray(taxWashSaleAdjustments.saleTransactionId, sellIds)).all()
    : [];
  const adjustmentsBySale = new Map<string, number>();
  for (const a of allAdjustments) {
    adjustmentsBySale.set(
      a.saleTransactionId,
      (adjustmentsBySale.get(a.saleTransactionId) ?? 0) + a.disallowedLossEur,
    );
  }

  for (const row of sellRows) {
    const consumptions = consumptionsBySale.get(row.id) ?? [];
    const costBasisEur = consumptions.reduce((s, c) => s + c.costBasisEur, 0);
    const rawGainLoss = row.tradeGrossAmountEur - costBasisEur - row.feesAmountEur;

    const nonComputable = adjustmentsBySale.get(row.id) ?? 0;
    // Disallowed loss reduces the magnitude of the loss (raw −200, disallowed 60 → computable −140).
    const computable = rawGainLoss < 0 ? rawGainLoss + nonComputable : rawGainLoss;

    const asset = assetById.get(row.assetId);

    sales.push({
      transactionId: row.id,
      valuationBasis: row.valuationBasis ?? null,
      tradedAt: row.tradedAt,
      accountId: row.accountId,
      assetId: row.assetId,
      quantity: row.quantity,
      // txEur(): these come straight off the transaction row / lot
      // consumptions — the user-data side of the provenance wall.
      proceedsEur: txEur(row.tradeGrossAmountEur),
      feesEur: txEur(row.feesAmountEur),
      costBasisEur: txEur(costBasisEur),
      rawGainLossEur: txEur(rawGainLoss),
      nonComputableLossEur: txEur(nonComputable),
      computableGainLossEur: txEur(computable),
      consumedLots: consumptions.map((c) => ({
        lotId: c.lotId,
        acquiredAt: lotById.get(c.lotId)?.acquiredAt ?? 0,
        qtyConsumed: c.qtyConsumed,
        costBasisEur: txEur(c.costBasisEur),
      })),
      assetName: asset?.name ?? null,
      isin: asset?.isin ?? null,
      assetClassTax: asset?.assetClassTax ?? null,
    });
  }

  const excluded = { count: 0, proceedsEur: 0, costBasisEur: 0 };
  const visibleSales = sales
    .filter((s) => {
      // Import artifact: no EUR proceeds means this is a fee-disposal synthesised
      // by the Binance parser, not a real sale. Always exclude regardless of size.
      // Dust: both sides tiny. Either way the exclusion is DISCLOSED via
      // excludedSales (audit T7), never silent.
      const drop =
        s.proceedsEur === 0 ||
        (Math.abs(s.proceedsEur) < DUST_THRESHOLD_EUR &&
          Math.abs(s.costBasisEur) < DUST_THRESHOLD_EUR);
      if (drop) {
        excluded.count += 1;
        excluded.proceedsEur = roundEur(excluded.proceedsEur + s.proceedsEur);
        excluded.costBasisEur = roundEur(excluded.costBasisEur + s.costBasisEur);
        return false;
      }
      return true;
    })
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
    const asset = assetById.get(row.assetId);
    return {
      transactionId: row.id,
      tradedAt: row.tradedAt,
      accountId: row.accountId,
      assetId: row.assetId,
      assetName: asset?.name ?? null,
      isin: asset?.isin ?? null,
      sourceCountry: row.sourceCountry,
      grossNative: row.dividendGross ?? row.tradeGrossAmount,
      grossEur: txEur(row.tradeGrossAmountEur),
      withholdingOrigenEur: txEur(row.withholdingTax ?? 0),
      withholdingDestinoEur: txEur(row.withholdingTaxDestination ?? 0),
      netEur: txEur(row.cashImpactEur),
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

  const yearEndBalances: YearEndBalance[] = buildYearEndBalances(db, end);

  return {
    year,
    sales: visibleSales,
    dividends,
    yearEndBalances,
    excludedSales: {
      count: excluded.count,
      proceedsEur: txEur(excluded.proceedsEur),
      costBasisEur: txEur(excluded.costBasisEur),
    },
    // Totals are float accumulations of cent-rounded terms — round once at
    // the aggregation boundary (audit T9) so exports never see 1234.5600000001.
    totals: {
      realizedGainsEur: txEur(roundEur(realizedGainsEur)),
      realizedLossesComputableEur: txEur(roundEur(realizedLossesComputableEur)),
      nonComputableLossesEur: txEur(roundEur(nonComputableLossesEur)),
      netComputableEur: txEur(roundEur(realizedGainsEur + realizedLossesComputableEur)),
      proceedsEur: txEur(roundEur(proceedsEur)),
      costBasisEur: txEur(roundEur(costBasisEur)),
      feesEur: txEur(roundEur(feesEur)),
      dividendsGrossEur: txEur(roundEur(dividendsGrossEur)),
      withholdingOrigenTotalEur: txEur(roundEur(withholdingOrigenTotalEur)),
      withholdingDestinoTotalEur: txEur(roundEur(withholdingDestinoTotalEur)),
    },
  };
}
