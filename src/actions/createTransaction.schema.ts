import { z } from "zod";
import { isoDatePastSchema } from "./_schemas";

export const createTransactionSchema = z
  .object({
    accountId: z.string().min(1),
    assetId: z.string().min(1),
    tradeDate: isoDatePastSchema,
    side: z.enum(["buy", "sell"]),
    quantity: z.number().finite().positive(),
    priceNative: z.number().finite().positive(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "La divisa debe ser un código ISO 4217 de 3 letras"),
    /** Broker FX rate in the broker's direction: 1 EUR = X CCY (DEGIRO shows
     *  e.g. 1.15 for USD). ALWAYS typed by hand for non-EUR trades — stored
     *  daily rates are never applied, they only act as a sanity guard. */
    fxEurToCcy: z.number().finite().positive().optional(),
    /** Broker fee in EUR — fees are always charged in EUR (European broker),
     *  even when the asset trades in another currency. Never FX-converted. */
    fees: z.number().finite().min(0).default(0),
    notes: z.string().trim().max(500).optional(),
    /** Audit R7: a second identical trade on the same day is flagged as a
     *  duplicate; pass true to record it anyway (salted fingerprint). */
    allowDuplicate: z.boolean().default(false),
    /** Audit H3: a manual FX rate >20% off the stored daily rate is rejected as
     *  a probable typo/inverse; pass true to use it anyway. */
    allowFxDeviation: z.boolean().default(false),
  })
  .refine((d) => d.currency === "EUR" || d.fxEurToCcy != null, {
    path: ["fxEurToCcy"],
    message: "Obligatorio en operaciones no-EUR: introduce el tipo 1 EUR = ? de tu broker.",
  });

export type CreateTransactionInput = z.input<typeof createTransactionSchema>;
