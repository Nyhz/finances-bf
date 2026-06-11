"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db as defaultDb, type DB } from "../db/client";
import { accounts, assets, assetTransactions, auditEvents, accountCashMovements } from "../db/schema";
import { rebuildAfterTradeMutation } from "../server/mutations";
import { FxDeviationError, FxManualRequiredError, requireManualFx } from "./_fx";
import { roundEur } from "../lib/money";
import { createDividendSchema } from "./createDividend.schema";
import { z } from "zod";
import {
  ACTOR,
  type ActionResult,
  isCashBearingAccount,
  revalidateTradeMutation,
} from "./_shared";

export async function createDividend(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createDividendSchema.safeParse(input);
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
      const asset = tx.select().from(assets).where(eq(assets.id, data.assetId)).get();
      if (!asset) throw new Error("asset not found");

      const tradedAt = new Date(`${data.tradeDate}T12:00:00.000Z`).getTime();
      // Audit T1: never default a foreign dividend to rate 1. The broker's
      // EUR→CCY rate is always typed by hand; daily fx_rates only guard.
      const fx = requireManualFx(tx, data.currency, data.tradeDate, data.fxEurToCcy, {
        allowDeviation: data.allowFxDeviation,
      });
      const fxRate = fx.rate;
      const grossEur = roundEur(data.grossNative * fxRate);
      const whtOrigenEur = roundEur(data.withholdingOrigenNative * fxRate);
      const whtDestinoEur = roundEur(data.withholdingDestinoEur);
      const netEur = roundEur(grossEur - whtOrigenEur - whtDestinoEur);
      // Audit M2 (EUR side): destination withholding lives in EUR, so it can
      // only be sanity-checked after FX resolution.
      if (netEur < 0) {
        throw new Error(
          `withholding exceeds gross: net would be ${netEur} EUR (gross ${grossEur} EUR)`,
        );
      }

      const id = ulid();
      tx.insert(assetTransactions).values({
        id, accountId: data.accountId, assetId: data.assetId,
        transactionType: "dividend", tradedAt,
        quantity: 0, unitPrice: 0,
        tradeCurrency: data.currency, fxRateToEur: fxRate, fxSource: fx.source,
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

      if (isCashBearingAccount(account.accountType)) {
        tx.insert(accountCashMovements).values({
          id: ulid(),
          accountId: data.accountId,
          movementType: "dividend",
          occurredAt: tradedAt,
          nativeAmount: data.grossNative - data.withholdingOrigenNative,
          currency: data.currency,
          fxRateToEur: fxRate,
          fxSource: fx.source,
          cashImpactEur: netEur,
          externalReference: id,
          rowFingerprint: `dividend:${id}`,
          source: "manual",
          description: `dividend ${asset.name}`,
          affectsCashBalance: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }).run();
      }
      rebuildAfterTradeMutation(tx, data.accountId, data.assetId, data.tradeDate);

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
        contextJson: JSON.stringify({
          actor: ACTOR,
          fxRateToEur: fxRate,
          fxSource: fx.source,
          fxStale: fx.stale ?? false,
        }),
        createdAt: Date.now(),
      }).run();

      return { id };
    });

    revalidateTradeMutation(data.accountId);
    return { ok: true, data: result };
  } catch (err) {
    if (err instanceof FxManualRequiredError) {
      return {
        ok: false,
        error: {
          code: "validation",
          message: err.message,
          fieldErrors: { fxEurToCcy: [err.message] },
        },
      };
    }
    if (err instanceof FxDeviationError) {
      return {
        ok: false,
        error: {
          code: "fx_deviation",
          message: err.message,
          fieldErrors: { fxEurToCcy: [err.message] },
        },
      };
    }
    const message = err instanceof Error ? err.message : "unknown";
    if (message.startsWith("withholding exceeds gross")) {
      // The thrown message is an internal English sentinel; rebuild the
      // user-facing sentence in Spanish from its parts.
      const m = message.match(
        /^withholding exceeds gross: net would be (\S+) EUR \(gross (\S+) EUR\)$/,
      );
      const friendly = m
        ? `La retención supera el dividendo bruto: el neto sería ${m[1]} EUR (bruto ${m[2]} EUR)`
        : "La retención supera el dividendo bruto";
      return {
        ok: false,
        error: {
          code: "validation",
          message: friendly,
          fieldErrors: { withholdingDestinoEur: [friendly] },
        },
      };
    }
    if (message.startsWith("account not found") || message.startsWith("asset not found")) {
      const friendly = message.startsWith("account not found")
        ? "cuenta no encontrada"
        : "activo no encontrado";
      return { ok: false, error: { code: "not_found", message: friendly } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
