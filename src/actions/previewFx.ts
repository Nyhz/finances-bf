"use server";

import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { dbFxLookup } from "./_fx";
import { FxUnavailableError, resolveFxRateSync, type FxSource } from "../lib/fx";
import type { ActionResult } from "./_shared";
import { isoDatePastSchema } from "./_schemas";

const previewFxSchema = z.object({
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code"),
  date: isoDatePastSchema,
});

export type FxPreview = {
  rate: number;
  source: FxSource;
  stale: boolean;
  /** ISO date of the stored rate actually used (may be earlier than requested). */
  rateDate: string | null;
};

/**
 * Read-only lookup of the stored daily rate so entry modals can show a
 * REFERENCE next to the (always manual) broker-rate field — the daily rate is
 * never applied to a transaction, it only powers this hint and the deviation
 * guard. No mutation: no audit event, no revalidate.
 */
export async function previewFx(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<FxPreview>> {
  const parsed = previewFxSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Datos no válidos" } };
  }
  const { currency, date } = parsed.data;
  try {
    const fx = resolveFxRateSync(currency, date, dbFxLookup(db));
    return {
      ok: true,
      data: {
        rate: fx.rate,
        source: fx.source,
        stale: fx.stale ?? false,
        rateDate: fx.rateDate ?? null,
      },
    };
  } catch (err) {
    if (err instanceof FxUnavailableError) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `No hay tipo de cambio almacenado para ${err.currency} a fecha ${err.isoDate} o anterior.`,
        },
      };
    }
    const message = err instanceof Error ? err.message : "unknown";
    return { ok: false, error: { code: "db", message } };
  }
}
