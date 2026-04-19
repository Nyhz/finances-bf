import { asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { DB } from "../../db/client";
import {
  assetTransactions,
  taxLotConsumptions,
  taxLots,
  taxWashSaleAdjustments,
} from "../../db/schema";

type MutableLot = {
  id: string;
  remainingQty: number;
  unitCostEur: number;
  deferredLossAddedEur: number;
  acquiredAt: number;
  originTransactionId: string;
  accountId: string;
};

export function recomputeLotsForAsset(tx: DB, assetId: string): void {
  // 1. Wipe previous derivations for this asset.
  const txnRows = tx
    .select({ id: assetTransactions.id })
    .from(assetTransactions)
    .where(eq(assetTransactions.assetId, assetId))
    .all();
  for (const { id } of txnRows) {
    tx.delete(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, id)).run();
    tx.delete(taxLotConsumptions).where(eq(taxLotConsumptions.saleTransactionId, id)).run();
  }
  tx.delete(taxLots).where(eq(taxLots.assetId, assetId)).run();

  // 2. Replay in chronological order.
  const rows = tx
    .select()
    .from(assetTransactions)
    .where(eq(assetTransactions.assetId, assetId))
    .orderBy(asc(assetTransactions.tradedAt), asc(assetTransactions.id))
    .all();

  const open: MutableLot[] = [];

  for (const row of rows) {
    if (row.transactionType === "buy") {
      if (row.quantity <= 0) continue;
      const unitCostEur = (row.tradeGrossAmountEur + row.feesAmountEur) / row.quantity;
      const lotId = ulid();
      tx.insert(taxLots).values({
        id: lotId,
        assetId,
        accountId: row.accountId,
        originTransactionId: row.id,
        acquiredAt: row.tradedAt,
        originalQty: row.quantity,
        remainingQty: row.quantity,
        unitCostEur,
        deferredLossAddedEur: 0,
      }).run();
      open.push({
        id: lotId,
        remainingQty: row.quantity,
        unitCostEur,
        deferredLossAddedEur: 0,
        acquiredAt: row.tradedAt,
        originTransactionId: row.id,
        accountId: row.accountId,
      });
      continue;
    }

    if (row.transactionType !== "sell") continue;

    let remaining = row.quantity;
    const consumptions: { lotId: string; qty: number; cost: number }[] = [];

    while (remaining > 1e-12 && open.length > 0) {
      const lot = open[0];
      const take = Math.min(lot.remainingQty, remaining);
      const unitCostWithDeferred =
        lot.unitCostEur +
        (lot.remainingQty > 0 ? lot.deferredLossAddedEur / lot.remainingQty : 0);
      const cost = take * unitCostWithDeferred;
      consumptions.push({ lotId: lot.id, qty: take, cost });
      // Consume a proportional share of the deferred credit too.
      const consumedDeferredShare =
        lot.remainingQty > 0 ? lot.deferredLossAddedEur * (take / lot.remainingQty) : 0;
      lot.remainingQty -= take;
      lot.deferredLossAddedEur = Math.max(0, lot.deferredLossAddedEur - consumedDeferredShare);
      remaining -= take;
      if (lot.remainingQty <= 1e-12) open.shift();
    }

    for (const c of consumptions) {
      tx.insert(taxLotConsumptions).values({
        id: ulid(),
        saleTransactionId: row.id,
        lotId: c.lotId,
        qtyConsumed: c.qty,
        costBasisEur: c.cost,
      }).run();
      // Persist updated remainingQty for each touched lot.
      const lot = open.find((l) => l.id === c.lotId);
      if (lot) {
        tx.update(taxLots).set({
          remainingQty: lot.remainingQty,
          deferredLossAddedEur: lot.deferredLossAddedEur,
        }).where(eq(taxLots.id, lot.id)).run();
      } else {
        tx.update(taxLots).set({ remainingQty: 0 }).where(eq(taxLots.id, c.lotId)).run();
      }
    }
  }
}
