"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db as defaultDb, type DB } from "../db/client";
import { accounts, assets, assetTransactions, auditEvents } from "../db/schema";
import { recomputeLotsForAsset } from "../server/tax/lots";
import { createSwapSchema } from "./createSwap.schema";
import { ACTOR, type ActionResult } from "./_shared";

export async function createSwap(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ sellId: string; buyId: string }>> {
  const parsed = createSwapSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "validation", message: "invalid input" } };
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
      const valueEur = data.valueEur;

      tx.insert(assetTransactions).values({
        id: sellId, accountId: data.accountId, assetId: data.outgoingAssetId,
        transactionType: "sell", tradedAt,
        quantity: data.outgoingQuantity,
        unitPrice: valueEur / data.outgoingQuantity,
        tradeCurrency: outgoing.currency, fxRateToEur: 1,
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
        tradeCurrency: incoming.currency, fxRateToEur: 1,
        tradeGrossAmount: valueEur, tradeGrossAmountEur: valueEur,
        cashImpactEur: -valueEur,
        feesAmount: 0, feesAmountEur: 0, netAmountEur: -valueEur,
        linkedTransactionId: sellId,
        isListed: false, source: "manual",
        notes: data.notes ?? `swap ← ${outgoing.name}`,
      }).run();

      recomputeLotsForAsset(tx, data.outgoingAssetId);
      recomputeLotsForAsset(tx, data.incomingAssetId);

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

    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath("/overview");
    revalidatePath("/taxes");
    revalidatePath("/assets");
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return { ok: false, error: { code: "db", message } };
  }
}
