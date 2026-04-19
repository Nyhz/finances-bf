"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { ulid } from "ulid";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  assetTransactions,
  auditEvents,
  taxLotConsumptions,
  taxLots,
  taxWashSaleAdjustments,
} from "../db/schema";
import { recomputeLotsForAsset } from "../server/tax/lots";
import { ACTOR, type ActionResult } from "./_shared";
import { reimportAccountSchema } from "./reimportAccount.schema";

export async function reimportAccount(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ deletedTransactions: number }>> {
  const parsed = reimportAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "invalid input" } };
  }
  const { accountId } = parsed.data;

  try {
    const result = db.transaction((tx) => {
      const txns = tx
        .select()
        .from(assetTransactions)
        .where(eq(assetTransactions.accountId, accountId))
        .all();
      const assetIds = [...new Set(txns.map((t) => t.assetId))];
      const txnIds = txns.map((t) => t.id);

      // Explicitly delete tax child rows before deleting transactions.
      // (ON DELETE CASCADE would handle it, but explicit is clearer.)
      if (txnIds.length > 0) {
        tx
          .delete(taxWashSaleAdjustments)
          .where(inArray(taxWashSaleAdjustments.saleTransactionId, txnIds))
          .run();
        tx
          .delete(taxLotConsumptions)
          .where(inArray(taxLotConsumptions.saleTransactionId, txnIds))
          .run();
        tx
          .delete(taxLots)
          .where(inArray(taxLots.originTransactionId, txnIds))
          .run();
      }

      tx.delete(assetTransactions).where(eq(assetTransactions.accountId, accountId)).run();
      tx.delete(accountCashMovements).where(eq(accountCashMovements.accountId, accountId)).run();

      // Recompute lots for every affected asset to clear stale state.
      for (const assetId of assetIds) {
        recomputeLotsForAsset(tx, assetId);
      }

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "account",
          entityId: accountId,
          action: "reimport-wipe",
          actorType: "user",
          source: "ui",
          summary: `wiped ${txns.length} transactions`,
          previousJson: JSON.stringify({ count: txns.length }),
          nextJson: null,
          contextJson: JSON.stringify({ actor: ACTOR }),
          createdAt: Date.now(),
        })
        .run();

      return { deletedTransactions: txns.length };
    });

    revalidatePath("/accounts");
    revalidatePath(`/accounts/${accountId}`);
    revalidatePath("/transactions");
    revalidatePath("/overview");
    revalidatePath("/taxes");

    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return { ok: false, error: { code: "db", message } };
  }
}
