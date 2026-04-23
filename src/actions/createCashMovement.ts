"use server";

import { and, desc, eq, lte } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  accounts,
  auditEvents,
  fxRates,
  type AccountCashMovement,
} from "../db/schema";
import {
  ACTOR,
  type ActionResult,
  revalidateCashMovement,
} from "./_shared";
import { cashMovementFingerprint } from "./_fingerprint";
import { recomputeAccountCashBalance } from "../server/recompute";

import {
  createCashMovementSchema,
  type CashMovementKind,
} from "./createCashMovement.schema";

function signFor(kind: CashMovementKind): 1 | -1 {
  switch (kind) {
    case "withdrawal":
    case "fee":
    case "transfer-out":
      return -1;
    default:
      return 1;
  }
}

export async function createCashMovement(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<AccountCashMovement>> {
  const parsed = createCashMovementSchema.safeParse(input);
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

  const data = parsed.data;
  const currency = data.currency;

  try {
    const inserted = db.transaction((tx) => {
      const account = tx.select().from(accounts).where(eq(accounts.id, data.accountId)).get();
      if (!account) throw new Error(`account not found: ${data.accountId}`);

      let rate = 1;
      if (data.fxRateToEur != null) rate = data.fxRateToEur;
      else if (currency !== "EUR") {
        const onDate = tx
          .select()
          .from(fxRates)
          .where(and(eq(fxRates.currency, currency), eq(fxRates.date, data.occurredAt)))
          .get();
        if (onDate) rate = onDate.rateToEur;
        else {
          const latest = tx
            .select()
            .from(fxRates)
            .where(and(eq(fxRates.currency, currency), lte(fxRates.date, data.occurredAt)))
            .orderBy(desc(fxRates.date))
            .get();
          if (!latest) throw new Error(`No FX rate available for ${currency} on ${data.occurredAt}`);
          rate = latest.rateToEur;
        }
      }

      const sign = signFor(data.kind);
      // amountNative may be provided unsigned; sign it via `kind` semantics.
      const magnitude = Math.abs(data.amountNative);
      const nativeAmount = sign * magnitude;
      const cashImpactEur = Math.round(nativeAmount * rate * 100) / 100;

      const occurredAtMs = new Date(`${data.occurredAt}T12:00:00.000Z`).getTime();
      const id = ulid();
      const fingerprint = cashMovementFingerprint({
        accountId: data.accountId,
        kind: data.kind,
        occurredAt: data.occurredAt,
        amountNative: nativeAmount,
        currency,
      });
      const now = Date.now();

      tx
        .insert(accountCashMovements)
        .values({
          id,
          accountId: data.accountId,
          movementType: data.kind,
          occurredAt: occurredAtMs,
          nativeAmount,
          currency,
          fxRateToEur: rate,
          cashImpactEur,
          rowFingerprint: fingerprint,
          source: "manual",
          description: data.description ?? null,
          affectsCashBalance: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      recomputeAccountCashBalance(tx, data.accountId);

      const row = tx
        .select()
        .from(accountCashMovements)
        .where(eq(accountCashMovements.id, id))
        .get();
      if (!row) throw new Error("cash movement insert vanished");

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "cash_movement",
          entityId: id,
          action: "create",
          actorType: "user",
          source: "ui",
          summary: row.description ?? null,
          previousJson: null,
          nextJson: JSON.stringify(row),
          contextJson: JSON.stringify({ actor: ACTOR, fxRateToEur: rate }),
          createdAt: now,
        })
        .run();

      return row;
    });

    revalidateCashMovement(data.accountId);
    return { ok: true, data: inserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.startsWith("account not found")) {
      return { ok: false, error: { code: "not_found", message } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
