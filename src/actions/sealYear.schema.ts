import { z } from "zod";
export const sealYearSchema = z.object({
  year: z.number().int().min(1900).max(9999),
  notes: z.string().trim().max(500).optional(),
  /** Explicit override to seal despite unvalued foreign year-end balances. */
  acknowledgeUnvalued: z.boolean().default(false),
});
export type SealYearInput = z.input<typeof sealYearSchema>;
export const unsealYearSchema = z.object({
  year: z.number().int().min(1900).max(9999),
});
