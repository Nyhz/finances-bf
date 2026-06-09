"use server";

import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { resolveFxForDate } from "./_fx";
import { FxUnavailableError, type FxSource } from "../lib/fx";
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
 * Read-only lookup so entry modals can show the rate that WILL be applied
 * (and its provenance/staleness) before the user submits — never lets money
 * be entered blind (audit H3). No mutation: no audit event, no revalidate.
 */
export async function previewFx(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<FxPreview>> {
  const parsed = previewFxSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "invalid input" } };
  }
  const { currency, date } = parsed.data;
  try {
    const fx = resolveFxForDate(db, currency, date);
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
          message: `No stored FX rate for ${err.currency} on or before ${err.isoDate}.`,
        },
      };
    }
    const message = err instanceof Error ? err.message : "unknown";
    return { ok: false, error: { code: "db", message } };
  }
}
