"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { accountCashMovements, assetTransactions, auditEvents } from "../db/schema";
import {
  ACTOR,
  type ActionResult,
  revalidateTradeMutation,
} from "./_shared";
import { rebuildAfterTradeMutation } from "../server/rebuild";

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
        message: "Datos no válidos",
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

      // Audit H2: swap legs come in linked pairs. Deleting one side alone
      // would leave a half-permuta — assets acquired that were never paid
      // for, and a dangling linkedTransactionId. Delete the pair as a unit.
      const linked = previous.linkedTransactionId
        ? tx
            .select()
            .from(assetTransactions)
            .where(eq(assetTransactions.id, previous.linkedTransactionId))
            .get()
        : undefined;

      // Cash movements reference their trade via externalReference; deleting
      // by reference is a no-op when none exist, so no account-type gate.
      tx
        .delete(accountCashMovements)
        .where(eq(accountCashMovements.externalReference, id))
        .run();
      tx.delete(assetTransactions).where(eq(assetTransactions.id, id)).run();
      if (linked) {
        tx
          .delete(accountCashMovements)
          .where(eq(accountCashMovements.externalReference, linked.id))
          .run();
        tx.delete(assetTransactions).where(eq(assetTransactions.id, linked.id)).run();
      }

      // Valuations before the deleted trade's date are unaffected (audit P1).
      const earliestAt = linked ? Math.min(previous.tradedAt, linked.tradedAt) : previous.tradedAt;
      const fromIso = new Date(earliestAt).toISOString().slice(0, 10);
      const assetIds = linked ? [previous.assetId, linked.assetId] : previous.assetId;
      rebuildAfterTradeMutation(tx, previous.accountId, assetIds, fromIso);

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
          contextJson: JSON.stringify({ actor: ACTOR, deletedLinkedId: linked?.id ?? null }),
          createdAt: now,
        })
        .run();
      if (linked) {
        tx
          .insert(auditEvents)
          .values({
            id: ulid(),
            entityType: "asset_transaction",
            entityId: linked.id,
            action: "delete",
            actorType: "user",
            source: "ui",
            summary: "deleted as the linked leg of a swap",
            previousJson: JSON.stringify(linked),
            nextJson: null,
            contextJson: JSON.stringify({ actor: ACTOR, deletedWithId: id }),
            createdAt: now,
          })
          .run();
      }

      return { accountId: previous.accountId };
    });

    revalidateTradeMutation(accountId);
    return { ok: true, data: { id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.startsWith("transaction not found")) {
      return { ok: false, error: { code: "not_found", message: "transacción no encontrada" } };
    }
    if (message.startsWith("tax-lots:")) {
      // FIFO replay aborts when removing this buy would leave a later sell
      // without units to consume — surface it as a validation error, not a
      // raw English db error.
      const friendly =
        "No se puede eliminar esta compra: ventas posteriores dependen de sus unidades (comprobación FIFO).";
      return { ok: false, error: { code: "validation", message: friendly } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
