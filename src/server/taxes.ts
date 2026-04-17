import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  accounts,
  assetTransactions,
  assets,
} from "../db/schema";

export async function getTaxYears(db: DB = defaultDb): Promise<number[]> {
  const rows = await db
    .select({ tradedAt: assetTransactions.tradedAt })
    .from(assetTransactions)
    .all();
  const cashRows = await db
    .select({ occurredAt: accountCashMovements.occurredAt })
    .from(accountCashMovements)
    .all();
  const years = new Set<number>();
  for (const row of rows) {
    years.add(new Date(row.tradedAt).getUTCFullYear());
  }
  for (const row of cashRows) {
    years.add(new Date(row.occurredAt).getUTCFullYear());
  }
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

function yearBoundsUtc(year: number): { start: number; end: number } {
  return {
    start: Date.UTC(year, 0, 1),
    end: Date.UTC(year + 1, 0, 1),
  };
}

type BuyLot = {
  remainingQty: number;
  unitCostEur: number;
};

export async function computeRealizedGainsForYear(
  year: number,
  db: DB = defaultDb,
): Promise<RealizedGainsYearResult> {
  const { start, end } = yearBoundsUtc(year);

  // Find (accountId, assetId) pairs with at least one sell in the year.
  const sellKeys = await db
    .select({
      accountId: assetTransactions.accountId,
      assetId: assetTransactions.assetId,
    })
    .from(assetTransactions)
    .where(
      and(
        eq(assetTransactions.transactionType, "sell"),
        gte(assetTransactions.tradedAt, start),
        lt(assetTransactions.tradedAt, end),
      ),
    )
    .all();

  const pairs = new Map<string, { accountId: string; assetId: string }>();
  for (const k of sellKeys) {
    pairs.set(`${k.accountId}::${k.assetId}`, k);
  }

  if (pairs.size === 0) {
    return {
      sales: [],
      totals: {
        realizedGainsEur: 0,
        realizedLossesEur: 0,
        netRealizedEur: 0,
        proceedsEur: 0,
        costBasisEur: 0,
        feesEur: 0,
      },
    };
  }

  const accountIds = new Set<string>();
  const assetIds = new Set<string>();
  for (const p of pairs.values()) {
    accountIds.add(p.accountId);
    assetIds.add(p.assetId);
  }

  const [accountRows, assetRows] = await Promise.all([
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(inArray(accounts.id, [...accountIds]))
      .all(),
    db
      .select({ id: assets.id, name: assets.name })
      .from(assets)
      .where(inArray(assets.id, [...assetIds]))
      .all(),
  ]);
  const accountName = new Map(accountRows.map((r) => [r.id, r.name]));
  const assetName = new Map(assetRows.map((r) => [r.id, r.name]));

  const sales: RealizedSale[] = [];

  for (const { accountId, assetId } of pairs.values()) {
    const rows = await db
      .select()
      .from(assetTransactions)
      .where(
        and(
          eq(assetTransactions.accountId, accountId),
          eq(assetTransactions.assetId, assetId),
        ),
      )
      .orderBy(asc(assetTransactions.tradedAt), asc(assetTransactions.id))
      .all();

    const lots: BuyLot[] = [];
    for (const row of rows) {
      if (row.transactionType === "buy") {
        if (row.quantity <= 0) continue;
        const totalCostEur = row.tradeGrossAmountEur + row.feesAmountEur;
        lots.push({
          remainingQty: row.quantity,
          unitCostEur: totalCostEur / row.quantity,
        });
        continue;
      }
      if (row.transactionType !== "sell") continue;

      // Consume FIFO lots.
      let remainingToSell = row.quantity;
      let consumedCostEur = 0;
      while (remainingToSell > 0 && lots.length > 0) {
        const lot = lots[0];
        const take = Math.min(lot.remainingQty, remainingToSell);
        consumedCostEur += take * lot.unitCostEur;
        lot.remainingQty -= take;
        remainingToSell -= take;
        if (lot.remainingQty <= 1e-12) {
          lots.shift();
        }
      }

      if (row.tradedAt < start || row.tradedAt >= end) continue;

      const proceedsEur = row.tradeGrossAmountEur;
      const feesEur = row.feesAmountEur;
      const realizedGainEur = proceedsEur - consumedCostEur - feesEur;

      sales.push({
        saleId: row.id,
        sellDate: row.tradedAt,
        accountId,
        accountName: accountName.get(accountId) ?? null,
        assetId,
        assetName: assetName.get(assetId) ?? null,
        quantity: row.quantity,
        proceedsEur,
        costBasisEur: consumedCostEur,
        feesEur,
        realizedGainEur,
      });
    }
  }

  sales.sort((a, b) => a.sellDate - b.sellDate);

  let realizedGainsEur = 0;
  let realizedLossesEur = 0;
  let proceedsEur = 0;
  let costBasisEur = 0;
  let feesEur = 0;
  for (const s of sales) {
    if (s.realizedGainEur >= 0) realizedGainsEur += s.realizedGainEur;
    else realizedLossesEur += s.realizedGainEur;
    proceedsEur += s.proceedsEur;
    costBasisEur += s.costBasisEur;
    feesEur += s.feesEur;
  }

  return {
    sales,
    totals: {
      realizedGainsEur,
      realizedLossesEur,
      netRealizedEur: realizedGainsEur + realizedLossesEur,
      proceedsEur,
      costBasisEur,
      feesEur,
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
  const { start, end } = yearBoundsUtc(year);
  const rows = await db
    .select({
      movementType: accountCashMovements.movementType,
      cashImpactEur: accountCashMovements.cashImpactEur,
    })
    .from(accountCashMovements)
    .where(
      and(
        inArray(accountCashMovements.movementType, ["dividend", "interest"]),
        gte(accountCashMovements.occurredAt, start),
        lt(accountCashMovements.occurredAt, end),
      ),
    )
    .all();

  let dividendsEur = 0;
  let interestEur = 0;
  for (const r of rows) {
    if (r.movementType === "dividend") dividendsEur += r.cashImpactEur;
    else if (r.movementType === "interest") interestEur += r.cashImpactEur;
  }

  return {
    dividendsEur,
    interestEur,
    totalEur: dividendsEur + interestEur,
  };
}
