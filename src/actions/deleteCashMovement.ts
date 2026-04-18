"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { accountCashMovements, auditEvents } from "../db/schema";
import { ACTOR, type ActionResult } from "./_shared";
import { recomputeAccountCashBalance } from "../server/recompute";

import { deleteCashMovementSchema } from "./deleteCashMovement.schema";

export async function deleteCashMovement(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteCashMovementSchema.safeParse(input);
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
    const accountId = db.transaction((tx) => {
      const previous = tx
        .select()
        .from(accountCashMovements)
        .where(eq(accountCashMovements.id, id))
        .get();
      if (!previous) throw new Error(`cash movement not found: ${id}`);
      if (previous.movementType === "trade") {
        throw new Error("trade cash movements are deleted via deleteTransaction");
      }

      tx.delete(accountCashMovements).where(eq(accountCashMovements.id, id)).run();
      recomputeAccountCashBalance(tx, previous.accountId);

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "cash_movement",
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

      return previous.accountId;
    });

    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath(`/accounts/${accountId}`);
    revalidatePath("/overview");
    revalidatePath("/");
    revalidatePath("/audit");
    return { ok: true, data: { id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.startsWith("cash movement not found")) {
      return { ok: false, error: { code: "not_found", message } };
    }
    if (message.startsWith("trade cash movements")) {
      return { ok: false, error: { code: "conflict", message } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
