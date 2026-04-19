"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { accountCashMovements, accounts, assetTransactions, auditEvents } from "../db/schema";
import { ACTOR, type ActionResult } from "./_shared";
import { recomputeAccountCashBalance, recomputeAssetPosition } from "../server/recompute";
import { recomputeLotsForAsset } from "../server/tax/lots";

import { deleteTransactionSchema } from "./deleteTransaction.schema";

export async function deleteTransaction(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteTransactionSchema.safeParse(input);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Invalid input",
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      },
    };
  }

  const { id } = parsed.data;
  const now = Date.now();

  try {
    const { accountId } = db.transaction((tx) => {
      const previous = tx
        .select()
        .from(assetTransactions)
        .where(eq(assetTransactions.id, id))
        .get();
      if (!previous) throw new Error(`transaction not found: ${id}`);

      const account = tx
        .select()
        .from(accounts)
        .where(eq(accounts.id, previous.accountId))
        .get();
      const tracksCash =
        account?.accountType === "bank" || account?.accountType === "savings";

      if (tracksCash) {
        tx
          .delete(accountCashMovements)
          .where(eq(accountCashMovements.externalReference, id))
          .run();
      }

      tx.delete(assetTransactions).where(eq(assetTransactions.id, id)).run();

      recomputeAssetPosition(tx, previous.accountId, previous.assetId);
      recomputeLotsForAsset(tx, previous.assetId);
      if (tracksCash) {
        recomputeAccountCashBalance(tx, previous.accountId);
      }

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "asset_transaction",
          entityId: id,
          action: "delete",
          actorType: "user",
          source: "ui",
          summary: null,
          previousJson: JSON.stringify(previous),
          nextJson: null,
          contextJson: JSON.stringify({ actor: ACTOR }),
          createdAt: now,
        })
        .run();

      return { accountId: previous.accountId };
    });

    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath(`/accounts/${accountId}`);
    revalidatePath("/overview");
    revalidatePath("/");
    revalidatePath("/assets");
    revalidatePath("/audit");
    return { ok: true, data: { id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.startsWith("transaction not found")) {
      return { ok: false, error: { code: "not_found", message } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
