import { z } from "zod";
export const createDividendSchema = z.object({
  accountId: z.string().min(1),
  assetId: z.string().min(1),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  grossNative: z.number().positive(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  fxRateToEur: z.number().positive().optional(),
  withholdingOrigenNative: z.number().nonnegative().default(0),
  withholdingDestinoEur: z.number().nonnegative().default(0),
  sourceCountry: z.string().trim().regex(/^[A-Z]{2}$/).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateDividendInput = z.input<typeof createDividendSchema>;
