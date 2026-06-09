import { z } from "zod";
import { isoDatePastSchema } from "./_schemas";

export const setManualPriceSchema = z.object({
  assetId: z.string().min(1),
  priceNative: z.number().finite().positive(),
  priceDate: isoDatePastSchema.optional(),
});

export type SetManualPriceInput = z.input<typeof setManualPriceSchema>;
