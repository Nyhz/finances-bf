import { max } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { assetTransactions } from "../db/schema";
import { listAccounts } from "./accounts";
import { listPositions, type PositionRow } from "./positions";

export type StatementAssetLine = {
  assetId: string;
  name: string;
  assetType: string;
  symbol: string | null;
  isin: string | null;
  currency: string;
  quantity: number;
  unitPriceEur: number | null;
  marketValueEur: number | null;
  costEur: number;
  pnlEur: number | null;
  pnlPct: number | null;
  /** Share of total invested market value (0..1); null when unvalued. */
  weight: number | null;
  valuationDate: string | null;
};

export type StatementGroup = {
  assetType: string;
  lines: StatementAssetLine[];
  marketValueEur: number;
  costEur: number;
  pnlEur: number;
  weight: number;
};

export type StatementAccountLine = {
  accountId: string;
  name: string;
  accountType: string;
  currency: string;
  cashEur: number;
  investedEur: number;
  totalEur: number;
};

export type StatementTotals = {
  investedMarketValueEur: number;
  investedCostEur: number;
  unrealizedPnlEur: number;
  unrealizedPnlPct: number | null;
  cashEur: number;
  netWorthEur: number;
  positionsCount: number;
  accountsCount: number;
};

export type StatementReport = {
  generatedAt: number;
  totals: StatementTotals;
  groups: StatementGroup[];
  accounts: StatementAccountLine[];
};

function toLine(row: PositionRow, totalMarketValueEur: number): StatementAssetLine {
  const marketValueEur = row.valuationEur;
  const costEur = row.position.totalCostEur;
  const pnlEur = marketValueEur != null ? marketValueEur - costEur : null;
  return {
    assetId: row.asset.id,
    name: row.asset.name,
    assetType: row.asset.assetType,
    symbol: row.asset.ticker ?? row.asset.symbol,
    isin: row.asset.isin,
    currency: row.asset.currency,
    quantity: row.position.quantity,
    unitPriceEur: row.valuation?.unitPriceEur ?? null,
    marketValueEur,
    costEur,
    pnlEur,
    pnlPct: pnlEur != null && costEur > 0 ? pnlEur / costEur : null,
    weight:
      marketValueEur != null && totalMarketValueEur > 0
        ? marketValueEur / totalMarketValueEur
        : null,
    valuationDate: row.valuation?.valuationDate ?? null,
  };
}

/** Group asset lines by assetType, biggest group first, biggest line first. */
export function groupAssetLines(
  lines: StatementAssetLine[],
  totalMarketValueEur: number,
): StatementGroup[] {
  const byType = new Map<string, StatementAssetLine[]>();
  for (const line of lines) {
    const bucket = byType.get(line.assetType) ?? [];
    bucket.push(line);
    byType.set(line.assetType, bucket);
  }
  const groups = [...byType.entries()].map(([assetType, groupLines]) => {
    const marketValueEur = groupLines.reduce((acc, l) => acc + (l.marketValueEur ?? 0), 0);
    const costEur = groupLines.reduce((acc, l) => acc + l.costEur, 0);
    return {
      assetType,
      lines: [...groupLines].sort(
        (a, b) => (b.marketValueEur ?? 0) - (a.marketValueEur ?? 0),
      ),
      marketValueEur,
      costEur,
      pnlEur: groupLines.reduce((acc, l) => acc + (l.pnlEur ?? 0), 0),
      weight: totalMarketValueEur > 0 ? marketValueEur / totalMarketValueEur : 0,
    };
  });
  return groups.sort((a, b) => b.marketValueEur - a.marketValueEur);
}

/** Primary account per asset: the one with the most recent trade. SQLite's
 *  bare-column-with-max() semantics return the accountId of the max row. */
function primaryAccountByAsset(db: DB): Map<string, string> {
  const rows = db
    .select({
      assetId: assetTransactions.assetId,
      accountId: assetTransactions.accountId,
      latestTradedAt: max(assetTransactions.tradedAt),
    })
    .from(assetTransactions)
    .groupBy(assetTransactions.assetId)
    .all();
  return new Map(rows.map((r) => [r.assetId, r.accountId]));
}

export async function getStatementReport(db: DB = defaultDb): Promise<StatementReport> {
  const [positions, accountsList] = await Promise.all([
    listPositions(db),
    listAccounts(db),
  ]);
  const assetAccount = primaryAccountByAsset(db);

  const open = positions.filter((row) => row.position.quantity > 0);
  const investedMarketValueEur = open.reduce(
    (acc, row) => acc + (row.valuationEur ?? 0),
    0,
  );
  const lines = open.map((row) => toLine(row, investedMarketValueEur));
  const groups = groupAssetLines(lines, investedMarketValueEur);

  const investedByAccount = new Map<string, number>();
  for (const row of open) {
    const accountId = assetAccount.get(row.position.assetId);
    if (!accountId || row.valuationEur == null) continue;
    investedByAccount.set(
      accountId,
      (investedByAccount.get(accountId) ?? 0) + row.valuationEur,
    );
  }

  const accounts: StatementAccountLine[] = accountsList
    .map((account) => {
      const investedEur = investedByAccount.get(account.id) ?? 0;
      return {
        accountId: account.id,
        name: account.name,
        accountType: account.accountType,
        currency: account.currency,
        cashEur: account.totalBalanceEur,
        investedEur,
        totalEur: account.totalBalanceEur + investedEur,
      };
    })
    .sort((a, b) => b.totalEur - a.totalEur);

  // P&L pct only over the cost of lines that actually have a valuation —
  // mixing unvalued cost into the denominator would understate the return.
  const valuedCostEur = lines.reduce(
    (acc, l) => acc + (l.marketValueEur != null ? l.costEur : 0),
    0,
  );
  const investedCostEur = lines.reduce((acc, l) => acc + l.costEur, 0);
  const unrealizedPnlEur = investedMarketValueEur - valuedCostEur;
  const cashEur = accounts.reduce((acc, a) => acc + a.cashEur, 0);

  return {
    generatedAt: Date.now(),
    totals: {
      investedMarketValueEur,
      investedCostEur,
      unrealizedPnlEur,
      unrealizedPnlPct: valuedCostEur > 0 ? unrealizedPnlEur / valuedCostEur : null,
      cashEur,
      netWorthEur: investedMarketValueEur + cashEur,
      positionsCount: lines.length,
      accountsCount: accounts.length,
    },
    groups,
    accounts,
  };
}
