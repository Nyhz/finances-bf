import {
  assetHintKey,
  makeRowFingerprint,
  normaliseDate,
  parseCsv,
  parseDecimal,
  parseNumericPrefix,
  rowsToObjects,
} from "./_shared";
import type {
  ImportParseError,
  ImportParseResult,
  ParsedImportRow,
} from "./types";

const SOURCE = "binance" as const;

/**
 * Quote currencies recognised when splitting a Binance pair like "BTCEUR".
 * Order matters: longest first so e.g. USDT is matched before USDC's prefix.
 */
const QUOTE_CURRENCIES = [
  "FDUSD",
  "BUSD",
  "TUSD",
  "USDT",
  "USDC",
  "DAI",
  "EUR",
  "GBP",
  "TRY",
  "BRL",
  "AUD",
  "BTC",
  "ETH",
  "BNB",
];

export function parseBinanceCsv(csv: string): ImportParseResult {
  const rows = parseCsv(csv);
  const { records } = rowsToObjects(rows);
  const out: ParsedImportRow[] = [];
  const errors: ImportParseError[] = [];

  records.forEach((rec, idx) => {
    const lookup = caseInsensitive(rec);
    const dateRaw = lookup("Date(UTC)") || lookup("Date");
    const tradeDate = normaliseDate(dateRaw);
    if (!tradeDate) {
      errors.push({
        rowIndex: idx,
        message: `Missing or unparseable Date(UTC): "${dateRaw}"`,
        rawRow: rec,
      });
      return;
    }
    const pair = (lookup("Pair") || "").toUpperCase();
    const split = splitPair(pair);
    if (!split) {
      errors.push({
        rowIndex: idx,
        message: `Unrecognised Pair: "${pair}"`,
        rawRow: rec,
      });
      return;
    }
    const sideRaw = lookup("Side").toUpperCase();
    if (sideRaw !== "BUY" && sideRaw !== "SELL") {
      errors.push({
        rowIndex: idx,
        message: `Unrecognised Side: "${sideRaw}"`,
        rawRow: rec,
      });
      return;
    }
    const side = sideRaw === "BUY" ? "buy" : "sell";
    const price = parseDecimal(lookup("Price"));
    const executed = parseNumericPrefix(lookup("Executed"));
    const amount = parseNumericPrefix(lookup("Amount"));
    const fee = parseNumericPrefix(lookup("Fee"));
    const feeCoin = (lookup("Fee Coin") || fee.unit || "").toUpperCase();

    if (price == null || executed.value == null) {
      errors.push({
        rowIndex: idx,
        message: "Trade row missing Price or Executed",
        rawRow: rec,
      });
      return;
    }

    const accountHint = lookup("Account") || "binance-spot";
    const assetHint = { symbol: split.base };
    const feeInQuote = !feeCoin || feeCoin === split.quote;
    const tradeFees = feeInQuote && fee.value != null ? fee.value : null;

    const tradeFingerprint = makeRowFingerprint({
      source: SOURCE,
      accountHint,
      tradeDate,
      assetHint: assetHintKey(assetHint),
      side,
      quantity: executed.value,
      priceNative: price,
    });
    out.push({
      kind: "trade",
      source: SOURCE,
      tradeDate,
      accountHint,
      rowFingerprint: tradeFingerprint,
      rawRow: rec,
      assetHint,
      side,
      quantity: executed.value,
      priceNative: price,
      currency: split.quote,
      fees: tradeFees,
    });

    // Fee paid in a different coin → emit a separate fee cash movement so the
    // ledger reflects the additional debit.
    if (!feeInQuote && fee.value != null && fee.value !== 0) {
      const feeAssetHint = { symbol: feeCoin };
      const feeFingerprint = makeRowFingerprint({
        source: SOURCE,
        accountHint,
        tradeDate,
        assetHint: assetHintKey(feeAssetHint),
        side: "fee",
        amountNative: fee.value,
      });
      out.push({
        kind: "cash_movement",
        source: SOURCE,
        tradeDate,
        accountHint,
        rowFingerprint: feeFingerprint,
        rawRow: rec,
        movement: "fee",
        amountNative: -Math.abs(fee.value),
        currency: feeCoin,
        assetHint: feeAssetHint,
      });
    }

    // Quote-currency amount sanity could be checked; but we don't fail when
    // executed*price ≠ amount because Binance occasionally rounds.
    void amount;
  });

  return { source: SOURCE, rows: out, errors };
}

function splitPair(pair: string): { base: string; quote: string } | null {
  for (const q of QUOTE_CURRENCIES) {
    if (pair.endsWith(q) && pair.length > q.length) {
      return { base: pair.slice(0, pair.length - q.length), quote: q };
    }
  }
  return null;
}

function caseInsensitive(rec: Record<string, string>) {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(rec)) map.set(k.toLowerCase(), v);
  return (key: string) => map.get(key.toLowerCase()) ?? "";
}
