import { z } from "zod";

export const confirmImportSchema = z.object({
  source: z.enum(["degiro", "binance", "cobas"]),
  accountId: z.string().min(1),
  csvText: z.string().min(1),
  overrides: z
    .record(z.string(), z.object({ assetId: z.string().min(1).optional() }))
    .optional(),
});

export type ConfirmImportInput = z.input<typeof confirmImportSchema>;

export type ConfirmImportResult = {
  inserted: number;
  insertedTrades: number;
  insertedCashMovements: number;
  skippedDuplicates: number;
  skippedErrors: number;
  createdAssets: number;
  fingerprints: string[];
};
