import { z } from "zod";
import { isoDatePastSchema } from "./_schemas";

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
  occurredAt: isoDatePastSchema,
  // Audit M3: direction comes from `kind` — a signed amount is a user mistake
  // (and 0 is a no-op row), so only strictly positive magnitudes are accepted.
  amountNative: z
    .number()
    .finite()
    .positive("Amount must be positive — the kind decides the direction"),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code"),
  fxRateToEur: z.number().finite().positive().optional(),
  description: z.string().trim().max(500).optional(),
  /** Audit M7: a second identical movement on the same day is flagged as a
   *  duplicate; pass true to record it anyway (salted fingerprint). */
  allowDuplicate: z.boolean().default(false),
  /** Audit H3: a manual FX rate >20% off the stored daily rate is rejected as
   *  a probable typo/inverse; pass true to use it anyway. */
  allowFxDeviation: z.boolean().default(false),
});

export type CreateCashMovementInput = z.input<typeof createCashMovementSchema>;
