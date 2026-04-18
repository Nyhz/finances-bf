export type ImportSource = "degiro" | "binance" | "cobas";

export type TradeSide = "buy" | "sell";

export type CashMovementKind =
  | "deposit"
  | "withdrawal"
  | "dividend"
  | "interest"
  | "fee";

export type AssetHint = {
  symbol?: string | null;
  isin?: string | null;
  name?: string | null;
};

type CommonFields = {
  source: ImportSource;
  tradeDate: string; // ISO yyyy-MM-dd (UTC)
  accountHint?: string | null;
  rowFingerprint: string;
  rawRow: Record<string, string>;
};

export type ParsedTradeRow = CommonFields & {
  kind: "trade";
  assetHint: AssetHint;
  side: TradeSide;
  quantity: number;
  priceNative: number;
  currency: string;
  fees?: number | null;
  /**
   * Broker-supplied EUR/native FX for this specific trade. When present, the
   * importer uses this instead of looking up a daily FX rate — DEGIRO and
   * similar publish the exact cross rate they charged.
   */
  fxRateToEurOverride?: number | null;
  /**
   * When true, `fees` is already in EUR (DEGIRO reports AutoFX + third-party
   * fees in EUR even for USD trades). Importer skips the FX conversion.
   */
  feesAlreadyEur?: boolean;
};

export type ParsedCashMovementRow = CommonFields & {
  kind: "cash_movement";
  movement: CashMovementKind;
  amountNative: number;
  currency: string;
  assetHint?: AssetHint | null;
};

export type ParsedImportRow = ParsedTradeRow | ParsedCashMovementRow;

export type ImportParseError = {
  rowIndex: number;
  message: string;
  rawRow?: Record<string, string>;
};

export type ImportParseResult = {
  source: ImportSource;
  rows: ParsedImportRow[];
  errors: ImportParseError[];
};
