import { z } from "zod";

export const setManualPriceSchema = z.object({
  assetId: z.string().min(1),
  priceNative: z.number().finite().positive(),
  priceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type SetManualPriceInput = z.input<typeof setManualPriceSchema>;
