import { z } from "zod";

export const CASH_MOVEMENT_KINDS = [
  "deposit",
  "withdrawal",
  "interest",
  "fee",
  "dividend",
  "transfer-in",
  "transfer-out",
] as const;
export type CashMovementKind = (typeof CASH_MOVEMENT_KINDS)[number];

export const createCashMovementSchema = z.object({
  accountId: z.string().min(1),
  kind: z.enum(CASH_MOVEMENT_KINDS),
  occurredAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "occurredAt must be ISO yyyy-MM-dd"),
  amountNative: z.number().finite(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code"),
  fxRateToEur: z.number().finite().positive().optional(),
  description: z.string().trim().max(500).optional(),
});

export type CreateCashMovementInput = z.input<typeof createCashMovementSchema>;
