"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  accounts,
  assetTransactions,
  auditEvents,
} from "../db/schema";
import { ACTOR, type ActionResult } from "./_shared";

export const deleteAccountSchema = z.object({
  id: z.string().min(1),
});

export type DeleteAccountInput = z.input<typeof deleteAccountSchema>;

export async function deleteAccount(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteAccountSchema.safeParse(input);
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
    db.transaction((tx) => {
      const previous = tx.select().from(accounts).where(eq(accounts.id, id)).get();
      if (!previous) throw new Error(`account not found: ${id}`);

      const txCount = tx
        .select({ n: sql<number>`count(*)` })
        .from(assetTransactions)
        .where(eq(assetTransactions.accountId, id))
        .get();
      const cashCount = tx
        .select({ n: sql<number>`count(*)` })
        .from(accountCashMovements)
        .where(eq(accountCashMovements.accountId, id))
        .get();

      if ((txCount?.n ?? 0) > 0 || (cashCount?.n ?? 0) > 0) {
        throw new Error("account has transactions or cash movements");
      }

      tx.delete(accounts).where(eq(accounts.id, id)).run();

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "account",
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
    });

    revalidatePath("/accounts");
    revalidatePath("/overview");
    revalidatePath("/audit");
    return { ok: true, data: { id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message === "account has transactions or cash movements") {
      return { ok: false, error: { code: "conflict", message } };
    }
    if (message.startsWith("account not found")) {
      return { ok: false, error: { code: "not_found", message } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
