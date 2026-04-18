import { z } from "zod";
import { ASSET_TYPES } from "./_shared";

export const updateAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  symbol: z.string().trim().min(1).max(32).optional(),
  isin: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i, "ISIN must be 12 alphanumeric characters")
    .transform((v) => v.toUpperCase())
    .nullable()
    .optional(),
  assetType: z.enum(ASSET_TYPES).optional(),
  exchange: z.string().trim().max(32).nullable().optional(),
  providerSymbol: z.string().trim().max(64).nullable().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateAssetInput = z.input<typeof updateAssetSchema>;
