"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, lte } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  accounts,
  assetTransactions,
  assets,
  auditEvents,
  type AssetTransaction,
} from "../db/schema";
import { ACTOR, type ActionResult } from "./_shared";
import { transactionFingerprint } from "./_fingerprint";
import { recomputeAccountCashBalance, recomputeAssetPosition } from "../server/recompute";
import { fxRates } from "../db/schema";

export const createTransactionSchema = z.object({
  accountId: z.string().min(1),
  assetId: z.string().min(1),
  tradeDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "tradeDate must be ISO yyyy-MM-dd"),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().finite().positive(),
  priceNative: z.number().finite().positive(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code"),
  fxRateToEur: z.number().finite().positive().optional(),
  fees: z.number().finite().min(0).default(0),
  notes: z.string().trim().max(500).optional(),
});

export type CreateTransactionInput = z.input<typeof createTransactionSchema>;

function revalidateTransactionPaths(accountId: string) {
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/overview");
  revalidatePath("/");
  revalidatePath("/assets");
  revalidatePath("/audit");
}

export async function createTransaction(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<AssetTransaction>> {
  const parsed = createTransactionSchema.safeParse(input);
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
      const asset = tx.select().from(assets).where(eq(assets.id, data.assetId)).get();
      if (!asset) throw new Error(`asset not found: ${data.assetId}`);

      let rate = 1;
      if (data.fxRateToEur != null) {
        rate = data.fxRateToEur;
      } else if (currency !== "EUR") {
        const onDate = tx
          .select()
          .from(fxRates)
          .where(and(eq(fxRates.currency, currency), eq(fxRates.date, data.tradeDate)))
          .get();
        if (onDate) rate = onDate.rateToEur;
        else {
          const latest = tx
            .select()
            .from(fxRates)
            .where(and(eq(fxRates.currency, currency), lte(fxRates.date, data.tradeDate)))
            .orderBy(desc(fxRates.date))
            .get();
          if (!latest) throw new Error(`No FX rate available for ${currency} on ${data.tradeDate}`);
          rate = latest.rateToEur;
        }
      }

      const sign = data.side === "buy" ? -1 : 1;
      const tradeGrossAmount = data.quantity * data.priceNative;
      const tradeGrossAmountEur = round(tradeGrossAmount * rate);
      const feesAmountEur = round(data.fees * rate);
      // cashImpactEur: buys reduce cash (incl. fees); sells add net proceeds.
      const cashImpactEur =
        sign * round(tradeGrossAmountEur) - feesAmountEur;
      const netAmountEur = cashImpactEur;

      const tradedAt = new Date(`${data.tradeDate}T12:00:00.000Z`).getTime();
      const id = ulid();
      const fingerprint = transactionFingerprint({
        accountId: data.accountId,
        assetId: data.assetId,
        tradeDate: data.tradeDate,
        side: data.side,
        quantity: data.quantity,
        priceNative: data.priceNative,
      });
      const now = Date.now();

      tx
        .insert(assetTransactions)
        .values({
          id,
          accountId: data.accountId,
          assetId: data.assetId,
          transactionType: data.side,
          tradedAt,
          quantity: data.quantity,
          unitPrice: data.priceNative,
          tradeCurrency: currency,
          fxRateToEur: rate,
          tradeGrossAmount: round(tradeGrossAmount),
          tradeGrossAmountEur,
          cashImpactEur: round(cashImpactEur),
          feesAmount: data.fees,
          feesAmountEur,
          netAmountEur: round(netAmountEur),
          rowFingerprint: fingerprint,
          source: "manual",
          notes: data.notes ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      tx
        .insert(accountCashMovements)
        .values({
          id: ulid(),
          accountId: data.accountId,
          movementType: "trade",
          occurredAt: tradedAt,
          nativeAmount: round(sign * tradeGrossAmount - data.fees),
          currency,
          fxRateToEur: rate,
          cashImpactEur: round(cashImpactEur),
          externalReference: id,
          rowFingerprint: `trade:${id}`,
          source: "manual",
          description: `${data.side} ${data.quantity} ${asset.symbol ?? asset.name}`,
          affectsCashBalance: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      recomputeAssetPosition(tx, data.accountId, data.assetId);
      recomputeAccountCashBalance(tx, data.accountId);

      const row = tx
        .select()
        .from(assetTransactions)
        .where(eq(assetTransactions.id, id))
        .get();
      if (!row) throw new Error("transaction insert vanished");

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "asset_transaction",
          entityId: id,
          action: "create",
          actorType: "user",
          source: "ui",
          summary: row.notes ?? null,
          previousJson: null,
          nextJson: JSON.stringify(row),
          contextJson: JSON.stringify({ actor: ACTOR, fxRateToEur: rate }),
          createdAt: now,
        })
        .run();

      return row;
    });

    revalidateTransactionPaths(data.accountId);
    return { ok: true, data: inserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.startsWith("account not found") || message.startsWith("asset not found")) {
      return { ok: false, error: { code: "not_found", message } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
