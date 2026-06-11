"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { accounts, assets, assetTransactions, auditEvents, accountCashMovements } from "../db/schema";
import { rebuildAfterTradeMutation } from "../server/mutations";
import { roundEur } from "../lib/money";
import { createSwapSchema } from "./createSwap.schema";
import {
  ACTOR,
  type ActionResult,
  isCashBearingAccount,
  revalidateTradeMutation,
} from "./_shared";

export async function createSwap(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ sellId: string; buyId: string }>> {
  const parsed = createSwapSchema.safeParse(input);
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
  const data = parsed.data;

  try {
    const result = db.transaction((tx) => {
      const account = tx.select().from(accounts).where(eq(accounts.id, data.accountId)).get();
      if (!account) throw new Error("account not found");
      const outgoing = tx.select().from(assets).where(eq(assets.id, data.outgoingAssetId)).get();
      if (!outgoing) throw new Error("outgoing asset not found");
      const incoming = tx.select().from(assets).where(eq(assets.id, data.incomingAssetId)).get();
      if (!incoming) throw new Error("incoming asset not found");

      const tradedAt = new Date(`${data.tradeDate}T12:00:00.000Z`).getTime();
      const sellId = ulid();
      const buyId = ulid();
      // Round at the boundary: this is the only path that writes an
      // unrounded EUR into tradeGrossAmountEur (→ tax-report proceeds); an
      // .xx5 value makes screen (Intl) and CSV (toFixed) disagree by a cent.
      const valueEur = roundEur(data.valueEur);

      // Audit H1: swap legs are deliberately EUR-denominated — the user enters
      // the swap's EUR valuation, so the monetary columns hold EUR and must say
      // so. Stamping the asset's currency with fxRateToEur=1 would record a row
      // whose native amount lies about its unit. tradeCurrency is therefore
      // "EUR" on both legs (rate 1, source "unit") and unitPrice is EUR/unit.
      tx.insert(assetTransactions).values({
        id: sellId, accountId: data.accountId, assetId: data.outgoingAssetId,
        transactionType: "sell", tradedAt,
        quantity: data.outgoingQuantity,
        unitPrice: valueEur / data.outgoingQuantity,
        tradeCurrency: "EUR", fxRateToEur: 1, fxSource: "unit",
        tradeGrossAmount: valueEur, tradeGrossAmountEur: valueEur,
        cashImpactEur: valueEur,
        feesAmount: 0, feesAmountEur: 0, netAmountEur: valueEur,
        linkedTransactionId: buyId,
        isListed: false, source: "manual",
        notes: data.notes ?? `swap → ${incoming.name}`,
      }).run();

      tx.insert(assetTransactions).values({
        id: buyId, accountId: data.accountId, assetId: data.incomingAssetId,
        transactionType: "buy", tradedAt,
        quantity: data.incomingQuantity,
        unitPrice: valueEur / data.incomingQuantity,
        tradeCurrency: "EUR", fxRateToEur: 1, fxSource: "unit",
        tradeGrossAmount: valueEur, tradeGrossAmountEur: valueEur,
        cashImpactEur: -valueEur,
        feesAmount: 0, feesAmountEur: 0, netAmountEur: -valueEur,
        linkedTransactionId: sellId,
        isListed: false, source: "manual",
        notes: data.notes ?? `swap ← ${outgoing.name}`,
      }).run();

      if (isCashBearingAccount(account.accountType)) {
        // A swap nets to zero cash (value out equals value in), so record a
        // zero cash movement for traceability. Balance refresh happens below.
        tx.insert(accountCashMovements).values({
          id: ulid(),
          accountId: data.accountId,
          movementType: "trade",
          occurredAt: tradedAt,
          nativeAmount: 0,
          currency: "EUR",
          fxRateToEur: 1,
          cashImpactEur: 0,
          externalReference: sellId,
          rowFingerprint: `swap:${sellId}`,
          source: "manual",
          description: `swap ${outgoing.name} → ${incoming.name}`,
          affectsCashBalance: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }).run();
      }
      rebuildAfterTradeMutation(
        tx,
        data.accountId,
        [data.outgoingAssetId, data.incomingAssetId],
        data.tradeDate,
      );

      tx.insert(auditEvents).values({
        id: ulid(),
        entityType: "asset_transaction",
        entityId: sellId,
        action: "create-swap",
        actorType: "user",
        source: "ui",
        summary: `swap ${data.outgoingQuantity} ${outgoing.name} → ${data.incomingQuantity} ${incoming.name}`,
        previousJson: null,
        nextJson: JSON.stringify({ sellId, buyId, valueEur }),
        contextJson: JSON.stringify({ actor: ACTOR }),
        createdAt: Date.now(),
      }).run();

      return { sellId, buyId };
    });

    revalidateTradeMutation(data.accountId);
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    if (message.startsWith("tax-lots:")) {
      const friendly = `La parte saliente supera las unidades poseídas en esa fecha (comprobación FIFO): ${message}`;
      return {
        ok: false,
        error: {
          code: "validation",
          message: friendly,
          fieldErrors: { outgoingQuantity: [friendly] },
        },
      };
    }
    if (message.startsWith("account not found")) {
      return { ok: false, error: { code: "not_found", message: "cuenta no encontrada" } };
    }
    if (message.endsWith("asset not found")) {
      return { ok: false, error: { code: "not_found", message: "activo no encontrado" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
