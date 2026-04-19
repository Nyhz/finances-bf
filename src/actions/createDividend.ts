"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db as defaultDb, type DB } from "../db/client";
import { accounts, assets, assetTransactions, auditEvents, accountCashMovements } from "../db/schema";
import { recomputeLotsForAsset } from "../server/tax/lots";
import { recomputeAssetPosition, recomputeAccountCashBalance } from "../server/recompute";
import { roundEur } from "../lib/money";
import { createDividendSchema } from "./createDividend.schema";
import { ACTOR, type ActionResult, isCashBearingAccount } from "./_shared";

export async function createDividend(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createDividendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "validation", message: "invalid input" } };
  const data = parsed.data;

  try {
    const result = db.transaction((tx) => {
      const account = tx.select().from(accounts).where(eq(accounts.id, data.accountId)).get();
      if (!account) throw new Error("account not found");
      const asset = tx.select().from(assets).where(eq(assets.id, data.assetId)).get();
      if (!asset) throw new Error("asset not found");

      const tradedAt = new Date(`${data.tradeDate}T12:00:00.000Z`).getTime();
      const fxRate = data.fxRateToEur ?? 1;
      const grossEur = roundEur(data.grossNative * fxRate);
      const whtOrigenEur = roundEur(data.withholdingOrigenNative * fxRate);
      const whtDestinoEur = roundEur(data.withholdingDestinoEur);
      const netEur = roundEur(grossEur - whtOrigenEur - whtDestinoEur);

      const id = ulid();
      tx.insert(assetTransactions).values({
        id, accountId: data.accountId, assetId: data.assetId,
        transactionType: "dividend", tradedAt,
        quantity: 0, unitPrice: 0,
        tradeCurrency: data.currency, fxRateToEur: fxRate,
        tradeGrossAmount: data.grossNative, tradeGrossAmountEur: grossEur,
        cashImpactEur: netEur,
        feesAmount: 0, feesAmountEur: 0, netAmountEur: netEur,
        dividendGross: data.grossNative,
        dividendNet: data.grossNative - data.withholdingOrigenNative,
        withholdingTax: whtOrigenEur,
        withholdingTaxDestination: whtDestinoEur,
        sourceCountry: data.sourceCountry ?? null,
        isListed: true, source: "manual",
        notes: data.notes ?? null,
      }).run();

      recomputeLotsForAsset(tx, data.assetId);
      recomputeAssetPosition(tx, data.accountId, data.assetId);

      if (isCashBearingAccount(account.accountType)) {
        tx.insert(accountCashMovements).values({
          id: ulid(),
          accountId: data.accountId,
          movementType: "dividend",
          occurredAt: tradedAt,
          nativeAmount: data.grossNative - data.withholdingOrigenNative,
          currency: data.currency,
          fxRateToEur: fxRate,
          cashImpactEur: netEur,
          externalReference: id,
          rowFingerprint: `dividend:${id}`,
          source: "manual",
          description: `dividend ${asset.name}`,
          affectsCashBalance: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }).run();
        recomputeAccountCashBalance(tx, data.accountId);
      }

      tx.insert(auditEvents).values({
        id: ulid(),
        entityType: "asset_transaction",
        entityId: id,
        action: "create-dividend",
        actorType: "user",
        source: "ui",
        summary: `dividend ${data.grossNative} ${data.currency} on ${asset.name}`,
        previousJson: null,
        nextJson: JSON.stringify({ id, grossEur, whtOrigenEur }),
        contextJson: JSON.stringify({ actor: ACTOR }),
        createdAt: Date.now(),
      }).run();

      return { id };
    });

    revalidatePath("/transactions");
    revalidatePath("/overview");
    revalidatePath("/taxes");
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return { ok: false, error: { code: "db", message } };
  }
}
