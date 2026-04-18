import { and, asc, eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import {
  accountCashMovements,
  accounts,
  assetPositions,
  assetTransactions,
} from "../db/schema";
import { isCashBearingAccount } from "../actions/_shared";

// Drizzle better-sqlite3 tx handle type. We keep it loose to avoid a circular
// import with the generated schema type — all calls here are schema-typed.
type Tx = Parameters<Parameters<typeof import("../db/client").db.transaction>[0]>[0];

function round(n: number, decimals = 6): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * Recompute the (global) asset_positions row by walking every asset_transactions
 * row for the asset in chronological order. The position row is scoped by
 * asset in the schema; `accountId` is accepted for call-site clarity but the
 * aggregation spans all accounts that hold the asset.
 *
 * Cost basis uses a running weighted-average: buys add `qty * unitPrice +
 * fees` to the pool; sells reduce the pool proportionally by the sold
 * fraction, leaving the average untouched. When quantity collapses to zero,
 * the position row is deleted so empty positions don't drift.
 */
export function recomputeAssetPosition(
  tx: Tx,
  _accountId: string,
  assetId: string,
): void {
  const rows = tx
    .select()
    .from(assetTransactions)
    .where(eq(assetTransactions.assetId, assetId))
    .orderBy(asc(assetTransactions.tradedAt), asc(assetTransactions.id))
    .all();

  let qty = 0;
  let totalCostNative = 0;
  let totalCostEur = 0;

  for (const row of rows) {
    if (row.transactionType === "buy") {
      qty += row.quantity;
      totalCostNative += row.tradeGrossAmount + row.feesAmount;
      totalCostEur += row.tradeGrossAmountEur + row.feesAmountEur;
    } else if (row.transactionType === "sell") {
      if (qty <= 0) {
        // Defensive: selling with no position; treat as no-op for cost basis.
        qty -= row.quantity;
        continue;
      }
      const fraction = Math.min(1, row.quantity / qty);
      totalCostNative -= totalCostNative * fraction;
      totalCostEur -= totalCostEur * fraction;
      qty -= row.quantity;
    }
    // dividend / fee: do not affect position quantity or cost basis here;
    // cash impact is captured on the paired cash_movement.
  }

  qty = round(qty, 10);

  if (qty <= 0) {
    tx.delete(assetPositions).where(eq(assetPositions.assetId, assetId)).run();
    return;
  }

  const averageCostNative = round(totalCostNative / qty);
  const averageCostEur = round(totalCostEur / qty);
  const now = Date.now();

  const existing = tx
    .select()
    .from(assetPositions)
    .where(eq(assetPositions.assetId, assetId))
    .get();

  if (existing) {
    tx
      .update(assetPositions)
      .set({
        quantity: qty,
        averageCost: averageCostEur,
        averageCostNative,
        totalCostNative: round(totalCostNative),
        totalCostEur: round(totalCostEur),
        updatedAt: now,
      })
      .where(eq(assetPositions.assetId, assetId))
      .run();
  } else {
    tx
      .insert(assetPositions)
      .values({
        id: ulid(),
        assetId,
        quantity: qty,
        averageCost: averageCostEur,
        averageCostNative,
        totalCostNative: round(totalCostNative),
        totalCostEur: round(totalCostEur),
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

/**
 * Recompute `account.currentCashBalanceEur` as `openingBalanceEur + Σ
 * cash_movements.cashImpactEur` (where `affectsCashBalance = true`). Trades
 * write a paired cash_movement in the same tx, so this single rollup covers
 * every cash event including trade settlement.
 */
export function recomputeAccountCashBalance(tx: Tx, accountId: string): void {
  const account = tx.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new Error(`account not found: ${accountId}`);

  if (!isCashBearingAccount(account.accountType)) {
    tx
      .update(accounts)
      .set({ currentCashBalanceEur: 0, updatedAt: Date.now() })
      .where(eq(accounts.id, accountId))
      .run();
    return;
  }

  const sumRow = tx
    .select({ total: sql<number>`coalesce(sum(${accountCashMovements.cashImpactEur}), 0)` })
    .from(accountCashMovements)
    .where(
      and(
        eq(accountCashMovements.accountId, accountId),
        eq(accountCashMovements.affectsCashBalance, true),
      ),
    )
    .get();

  const movements = sumRow?.total ?? 0;
  const next = Math.round((account.openingBalanceEur + movements) * 100) / 100;

  tx
    .update(accounts)
    .set({ currentCashBalanceEur: next, updatedAt: Date.now() })
    .where(eq(accounts.id, accountId))
    .run();
}
