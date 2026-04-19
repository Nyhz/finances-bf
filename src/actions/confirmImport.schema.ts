import { z } from "zod";

export const confirmImportSchema = z.object({
  source: z.enum(["degiro", "binance", "cobas", "degiro-statement"]),
  accountId: z.string().min(1),
  csvText: z.string().min(1),
  overrides: z
    .record(z.string(), z.object({ assetId: z.string().min(1).optional() }))
    .optional(),
  /**
   * Per-symbolKey CoinGecko coin id (e.g. "BNB" -> "binancecoin") collected
   * from the ImportWizard picker. Written to `assets.providerSymbol` when a
   * new crypto asset is auto-created for that hint.
   */
  cryptoProviderOverrides: z.record(z.string(), z.string().min(1).max(64)).optional(),
});

export type ConfirmImportInput = z.input<typeof confirmImportSchema>;

export type ConfirmImportResult = {
  inserted: number;
  insertedTrades: number;
  insertedCashMovements: number;
  insertedDividends: number;
  skippedDuplicates: number;
  skippedErrors: number;
  createdAssets: number;
  fingerprints: string[];
};
