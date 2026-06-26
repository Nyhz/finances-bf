"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import {
  assets,
  auditEvents,
  priceHistory,
  type PriceHistoryRow,
} from "../db/schema";
import { rebuildValuationsForAsset } from "../server/valuations";
import { priceSymbolForAsset } from "../lib/price-sync";
import {
  FxUnavailableError,
  resolveFxRateSync,
  toIsoDate,
  type FxSource,
} from "../lib/fx";
import { dbFxLookup } from "./_fx";
import { roundEur } from "../lib/money";
import { ACTOR, type ActionResult } from "./_shared";
import { setManualPriceSchema } from "./setManualPrice.schema";

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
        message: "Datos no válidos",
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      },
    };
  }

  const { assetId, priceNative } = parsed.data;
  const priceDate = parsed.data.priceDate ?? toIsoDate(new Date());

  try {
    const asset = await db.select().from(assets).where(eq(assets.id, assetId)).get();
    if (!asset) {
      return { ok: false, error: { code: "not_found", message: "activo no encontrado" } };
    }
    // Same symbol the sync/backfill/valuation-rebuild use (FT → ISIN:CURRENCY)
    // so a manual price lands in the asset's one price-history series.
    const symbol = priceSymbolForAsset(asset);
    if (!symbol) {
      return {
        ok: false,
        error: {
          code: "validation",
          message: "El activo no tiene símbolo con el que registrar el histórico de precios",
        },
      };
    }

    const fx = resolveFxRateSync(asset.currency, priceDate, dbFxLookup(db));
    const fxRate: number = fx.rate;
    const fxSource: FxSource = fx.source;

    const priceEur = roundEur(priceNative * fxRate);
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

      // Audit M5: rebuild the valuation series from the priced date forward
      // instead of patching a single pre-existing row. A manual price for a
      // held-but-never-valued asset (the main use case) or a past date must
      // create/refresh every carried-forward day, or a Dec-31 manual price
      // silently never reaches the M720 year-end export.
      rebuildValuationsForAsset(tx, assetId, priceDate);

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
            valuationsRebuiltFrom: priceDate,
          }),
          createdAt: now,
        })
        .run();

      return priceRow;
    });

    revalidatePath("/");
    revalidatePath("/assets");
    // Manual prices feed the valuation series → year-end balances on /taxes.
    revalidatePath("/taxes");
    revalidatePath("/audit");

    return { ok: true, data: result };
  } catch (err) {
    if (err instanceof FxUnavailableError) {
      const friendly = `No hay tipo de cambio almacenado para ${err.currency} a fecha ${err.isoDate} o anterior — sincroniza FX primero.`;
      return {
        ok: false,
        error: {
          code: "validation",
          message: friendly,
          fieldErrors: {
            priceDate: [friendly],
          },
        },
      };
    }
    const message = err instanceof Error ? err.message : "Unknown DB error";
    return { ok: false, error: { code: "db", message } };
  }
}
