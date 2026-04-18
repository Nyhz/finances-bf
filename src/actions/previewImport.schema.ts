import { z } from "zod";
import type {
  AssetHint,
  ImportParseError,
  ImportSource,
} from "../lib/imports/types";
import type { CoinCandidate } from "../lib/pricing";

export const previewImportSchema = z.object({
  source: z.enum(["degiro", "binance", "cobas"]),
  accountId: z.string().min(1),
  csvText: z.string().min(1),
});

export type PreviewImportInput = z.input<typeof previewImportSchema>;

export type PreviewRowStatus = "new" | "duplicate" | "needs_asset_creation";

export type PreviewRow = {
  index: number;
  kind: "trade" | "cash_movement";
  status: PreviewRowStatus;
  tradeDate: string;
  rowFingerprint: string;
  currency: string;
  assetHint?: AssetHint | null;
  matchedAssetId: string | null;
  side?: "buy" | "sell";
  movement?: string;
  quantity?: number;
  priceNative?: number;
  amountNative?: number;
  fees?: number | null;
};

export type PreviewCounts = {
  total: number;
  new: number;
  duplicate: number;
  needsAssetCreation: number;
  errors: number;
};

export type CryptoCandidateGroup = {
  /** Stable key derived from the asset hint (matches the overrides map on confirm). */
  symbolKey: string;
  /** Uppercased CSV symbol shown to the user — e.g. "BNB". */
  symbol: string;
  /** Top CoinGecko matches for this symbol, sorted by market-cap rank. */
  candidates: CoinCandidate[];
  /** Populated when the CoinGecko lookup failed so the UI can explain it. */
  error?: string | null;
};

export type PreviewPayload = {
  source: ImportSource;
  accountId: string;
  rows: PreviewRow[];
  errors: ImportParseError[];
  counts: PreviewCounts;
  cryptoCandidates: CryptoCandidateGroup[];
};
