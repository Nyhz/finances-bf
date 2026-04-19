import { z } from "zod";
export const createSwapSchema = z.object({
  accountId: z.string().min(1),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "yyyy-MM-dd"),
  outgoingAssetId: z.string().min(1),
  outgoingQuantity: z.number().positive(),
  incomingAssetId: z.string().min(1),
  incomingQuantity: z.number().positive(),
  valueEur: z.number().positive(),
  feeAssetId: z.string().min(1).optional(),
  feeQuantity: z.number().nonnegative().optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateSwapInput = z.input<typeof createSwapSchema>;
