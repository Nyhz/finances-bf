import { z } from "zod";
import { isoDatePastSchema } from "./_schemas";
export const createSwapSchema = z.object({
  accountId: z.string().min(1),
  tradeDate: isoDatePastSchema,
  outgoingAssetId: z.string().min(1),
  outgoingQuantity: z.number().positive(),
  incomingAssetId: z.string().min(1),
  incomingQuantity: z.number().positive(),
  valueEur: z.number().positive(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateSwapInput = z.input<typeof createSwapSchema>;
