"use server";

import { eq } from "drizzle-orm";
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
import {
  ACTOR,
  type ActionResult,
  isCashBearingAccount,
  revalidateTradeMutation,
} from "./_shared";
import { transactionFingerprint } from "./_fingerprint";
import { rebuildAfterTradeMutation } from "../server/mutations";
import { FxDeviationError, resolveFxForDate } from "./_fx";
import { FxUnavailableError } from "../lib/fx";
import { roundEur as round } from "../lib/money";

import { createTransactionSchema } from "./createTransaction.schema";

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

      // Audit H4: the unit price is by definition denominated in the asset's
      // quote currency. A mismatched currency records a wrong EUR amount at
      // rate 1.0 without any flag — reject instead of trusting free text.
      if (currency !== asset.currency) {
        throw new Error(
          `currency mismatch: trade entered in ${currency} but ${asset.symbol ?? asset.name} is quoted in ${asset.currency}`,
        );
      }

      // Audit H5: pre-check sells against units actually held so an oversell
      // surfaces as a quantity error, not as the FIFO engine's internal abort.
      // Holdings are summed across all accounts — FIFO lots are global per asset.
      if (data.side === "sell") {
        const ledger = tx
          .select({
            quantity: assetTransactions.quantity,
            transactionType: assetTransactions.transactionType,
          })
          .from(assetTransactions)
          .where(eq(assetTransactions.assetId, data.assetId))
          .all();
        const held = ledger.reduce(
          (sum, row) =>
            row.transactionType === "buy"
              ? sum + row.quantity
              : row.transactionType === "sell"
                ? sum - row.quantity
                : sum,
          0,
        );
        if (data.quantity > held + 1e-9) {
          throw new Error(`oversell: ${held}`);
        }
      }

      const fx = resolveFxForDate(tx, currency, data.tradeDate, data.fxRateToEur, {
        allowDeviation: data.allowFxDeviation,
      });
      const rate = fx.rate;

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
      const baseFingerprint = transactionFingerprint({
        accountId: data.accountId,
        assetId: data.assetId,
        tradeDate: data.tradeDate,
        side: data.side,
        quantity: data.quantity,
        priceNative: data.priceNative,
      });
      // Audit R7: two genuinely identical fills on one day collide on the
      // unique index. Without the override this is a friendly "duplicate"
      // error; with it, the fingerprint is salted with the new row id.
      const collision = tx
        .select({ id: assetTransactions.id })
        .from(assetTransactions)
        .where(eq(assetTransactions.rowFingerprint, baseFingerprint))
        .get();
      if (collision && !data.allowDuplicate) {
        throw new Error(`duplicate transaction: ${collision.id}`);
      }
      const fingerprint = collision ? `${baseFingerprint}:dup:${id}` : baseFingerprint;
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
          fxSource: fx.source,
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

      const tracksCash = isCashBearingAccount(account.accountType);
      if (tracksCash) {
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
            fxSource: fx.source,
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
      }
      // Single source of truth: positions + lots + valuations + cash balance.
      rebuildAfterTradeMutation(tx, data.accountId, data.assetId, data.tradeDate);

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
          contextJson: JSON.stringify({
            actor: ACTOR,
            fxRateToEur: rate,
            fxSource: fx.source,
            fxStale: fx.stale ?? false,
          }),
          createdAt: now,
        })
        .run();

      return row;
    });

    revalidateTradeMutation(data.accountId);
    return { ok: true, data: inserted };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("duplicate transaction")) {
      return {
        ok: false,
        error: {
          code: "duplicate",
          message:
            "An identical transaction (same account, asset, date, side, quantity, price) already exists.",
        },
      };
    }
    if (err instanceof FxUnavailableError) {
      return {
        ok: false,
        error: {
          code: "validation",
          message: err.message,
          fieldErrors: {
            fxRateToEur: [
              `No stored FX rate for ${err.currency} on or before ${err.isoDate} — enter the broker's rate manually.`,
            ],
          },
        },
      };
    }
    if (err instanceof FxDeviationError) {
      return {
        ok: false,
        error: {
          code: "fx_deviation",
          message: err.message,
          fieldErrors: { fxRateToEur: [err.message] },
        },
      };
    }
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.startsWith("currency mismatch")) {
      return {
        ok: false,
        error: { code: "validation", message, fieldErrors: { currency: [message] } },
      };
    }
    if (message.startsWith("oversell:")) {
      const held = Number(message.slice("oversell:".length));
      const friendly = `Only ${Number(held.toFixed(8))} units are held across all accounts — cannot sell more than that.`;
      return {
        ok: false,
        error: { code: "validation", message: friendly, fieldErrors: { quantity: [friendly] } },
      };
    }
    if (message.startsWith("tax-lots:")) {
      // Defensive fallback: the FIFO replay still aborts the transaction on
      // chronology-level oversells the simple holdings sum can't see.
      const friendly = `This sell exceeds the units held on that date (FIFO check): ${message}`;
      return {
        ok: false,
        error: { code: "validation", message: friendly, fieldErrors: { quantity: [friendly] } },
      };
    }
    if (message.startsWith("account not found") || message.startsWith("asset not found")) {
      return { ok: false, error: { code: "not_found", message } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
