import { z } from "zod";
import { isoDatePastSchema } from "./_schemas";
export const createDividendSchema = z
  .object({
    accountId: z.string().min(1),
    assetId: z.string().min(1),
    tradeDate: isoDatePastSchema,
    grossNative: z.number().finite().positive(),
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    fxRateToEur: z.number().finite().positive().optional(),
    withholdingOrigenNative: z.number().finite().nonnegative().default(0),
    withholdingDestinoEur: z.number().finite().nonnegative().default(0),
    sourceCountry: z.string().trim().regex(/^[A-Z]{2}$/).optional(),
    notes: z.string().trim().max(500).optional(),
    /** Audit H3: a manual FX rate >20% off the stored daily rate is rejected as
     *  a probable typo/inverse; pass true to use it anyway. */
    allowFxDeviation: z.boolean().default(false),
  })
  // Audit M2: withholding above the gross would record a negative net without
  // complaint — reject at the boundary.
  .refine((d) => d.withholdingOrigenNative <= d.grossNative, {
    path: ["withholdingOrigenNative"],
    message: "Withholding at origin cannot exceed the gross dividend",
  });
export type CreateDividendInput = z.input<typeof createDividendSchema>;
