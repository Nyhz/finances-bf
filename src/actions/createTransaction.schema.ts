import { z } from "zod";

export const createTransactionSchema = z.object({
  accountId: z.string().min(1),
  assetId: z.string().min(1),
  tradeDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "tradeDate must be ISO yyyy-MM-dd"),
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
});

export type CreateTransactionInput = z.input<typeof createTransactionSchema>;
