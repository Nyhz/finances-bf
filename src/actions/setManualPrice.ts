"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, lte } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import {
  assetValuations,
  assets,
  auditEvents,
  fxRates,
  priceHistory,
  type PriceHistoryRow,
} from "../db/schema";
import { toIsoDate, type FxLookup } from "../lib/fx";
import { ACTOR, type ActionResult } from "./_shared";

export const setManualPriceSchema = z.object({
  assetId: z.string().min(1),
  priceNative: z.number().finite().positive(),
  priceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type SetManualPriceInput = z.input<typeof setManualPriceSchema>;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function setManualPrice(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<PriceHistoryRow>> {
  const parsed = setManualPriceSchema.safeParse(input);
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

  const { assetId, priceNative } = parsed.data;
  const priceDate = parsed.data.priceDate ?? toIsoDate(new Date());

  try {
    const asset = await db.select().from(assets).where(eq(assets.id, assetId)).get();
    if (!asset) {
      return { ok: false, error: { code: "not_found", message: `asset not found: ${assetId}` } };
    }
    const symbol = asset.providerSymbol ?? asset.symbol ?? asset.ticker;
    if (!symbol) {
      return {
        ok: false,
        error: { code: "validation", message: "asset has no symbol to key price history on" },
      };
    }

    const lookup: FxLookup = {
      findOnDate: async (currency, isoDate) => {
        const row = await db
          .select()
          .from(fxRates)
          .where(and(eq(fxRates.currency, currency), eq(fxRates.date, isoDate)))
          .get();
        return row ? { currency: row.currency, date: row.date, rateToEur: row.rateToEur } : null;
      },
      findLatest: async (currency, onOrBefore) => {
        const row = await db
          .select()
          .from(fxRates)
          .where(
            onOrBefore
              ? and(eq(fxRates.currency, currency), lte(fxRates.date, onOrBefore))
              : eq(fxRates.currency, currency),
          )
          .orderBy(desc(fxRates.date))
          .get();
        return row ? { currency: row.currency, date: row.date, rateToEur: row.rateToEur } : null;
      },
    };

    let fxRate = 1;
    let fxSource: "unit" | "historical" | "latest" = "unit";
    if (asset.currency !== "EUR") {
      const onDate = await lookup.findOnDate(asset.currency, priceDate);
      if (onDate) {
        fxRate = onDate.rateToEur;
        fxSource = "historical";
      } else {
        const latest = await lookup.findLatest(asset.currency, priceDate);
        if (!latest) {
          throw new Error(`No FX rate available for ${asset.currency} on ${priceDate}`);
        }
        fxRate = latest.rateToEur;
        fxSource = "latest";
      }
    }

    const priceEur = roundMoney(priceNative * fxRate);
    const now = Date.now();

    const result = db.transaction((tx) => {
      const existingPrice = tx
        .select()
        .from(priceHistory)
        .where(and(eq(priceHistory.symbol, symbol), eq(priceHistory.pricedDateUtc, priceDate)))
        .get();

      let priceRow: PriceHistoryRow;
      if (existingPrice) {
        tx
          .update(priceHistory)
          .set({ price: priceNative, source: "manual", pricedAt: now })
          .where(eq(priceHistory.id, existingPrice.id))
          .run();
        priceRow = tx.select().from(priceHistory).where(eq(priceHistory.id, existingPrice.id)).get()!;
      } else {
        const id = ulid();
        tx
          .insert(priceHistory)
          .values({
            id,
            symbol,
            price: priceNative,
            pricedAt: now,
            pricedDateUtc: priceDate,
            source: "manual",
            createdAt: now,
          })
          .run();
        priceRow = tx.select().from(priceHistory).where(eq(priceHistory.id, id)).get()!;
      }

      const existingValuation = tx
        .select()
        .from(assetValuations)
        .where(
          and(
            eq(assetValuations.assetId, assetId),
            eq(assetValuations.valuationDate, priceDate),
          ),
        )
        .get();
      if (existingValuation) {
        const marketValueEur = roundMoney(existingValuation.quantity * priceEur);
        tx
          .update(assetValuations)
          .set({
            unitPriceEur: priceEur,
            marketValueEur,
            priceSource: "manual",
          })
          .where(eq(assetValuations.id, existingValuation.id))
          .run();
      }

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "asset",
          entityId: assetId,
          action: "manual_price_override",
          actorType: "user",
          source: "ui",
          summary: null,
          previousJson: existingPrice ? JSON.stringify(existingPrice) : null,
          nextJson: JSON.stringify(priceRow),
          contextJson: JSON.stringify({
            actor: ACTOR,
            priceDate,
            priceNative,
            priceEur,
            currency: asset.currency,
            fxRateToEur: fxRate,
            fxSource,
            updatedValuation: Boolean(existingValuation),
          }),
          createdAt: now,
        })
        .run();

      return priceRow;
    });

    revalidatePath("/assets");
    revalidatePath("/overview");
    revalidatePath("/positions");
    revalidatePath("/audit");

    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    return { ok: false, error: { code: "db", message } };
  }
}
