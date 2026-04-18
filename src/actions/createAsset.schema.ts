import { z } from "zod";
import { ASSET_TYPES } from "./_shared";

const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code");

export const createAssetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  symbol: z.string().trim().min(1).max(32),
  isin: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i, "ISIN must be 12 alphanumeric characters")
    .transform((v) => v.toUpperCase())
    .nullable()
    .optional(),
  assetType: z.enum(ASSET_TYPES),
  currency: currencyCode,
  exchange: z.string().trim().max(32).nullable().optional(),
  providerSymbol: z.string().trim().max(64).nullable().optional(),
  isActive: z.boolean().default(true),
});

export type CreateAssetInput = z.input<typeof createAssetSchema>;
