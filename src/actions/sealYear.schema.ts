import { z } from "zod";
export const sealYearSchema = z.object({
  year: z.number().int().min(1900).max(9999),
  notes: z.string().trim().max(500).optional(),
});
export type SealYearInput = z.input<typeof sealYearSchema>;
export const unsealYearSchema = z.object({
  year: z.number().int().min(1900).max(9999),
});
