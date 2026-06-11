import { z } from "zod";
import { isoDatePastSchema } from "./_schemas";
export const createSwapSchema = z
  .object({
    accountId: z.string().min(1),
    tradeDate: isoDatePastSchema,
    outgoingAssetId: z.string().min(1),
    outgoingQuantity: z.number().positive(),
    incomingAssetId: z.string().min(1),
    incomingQuantity: z.number().positive(),
    valueEur: z.number().positive(),
    notes: z.string().trim().max(500).optional(),
    /** A second identical swap on the same day is flagged as a duplicate;
     *  pass true to record it anyway (salted fingerprints). */
    allowDuplicate: z.boolean().default(false),
  })
  .refine((d) => d.outgoingAssetId !== d.incomingAssetId, {
    path: ["incomingAssetId"],
    message: "El activo entrante debe ser distinto del saliente",
  });
export type CreateSwapInput = z.input<typeof createSwapSchema>;
