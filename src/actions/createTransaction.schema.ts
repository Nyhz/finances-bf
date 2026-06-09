import { z } from "zod";
import { isoDatePastSchema } from "./_schemas";

export const createTransactionSchema = z.object({
  accountId: z.string().min(1),
  assetId: z.string().min(1),
  tradeDate: isoDatePastSchema,
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
  /** Audit R7: a second identical trade on the same day is flagged as a
   *  duplicate; pass true to record it anyway (salted fingerprint). */
  allowDuplicate: z.boolean().default(false),
  /** Audit H3: a manual FX rate >20% off the stored daily rate is rejected as
   *  a probable typo/inverse; pass true to use it anyway. */
  allowFxDeviation: z.boolean().default(false),
});

export type CreateTransactionInput = z.input<typeof createTransactionSchema>;
