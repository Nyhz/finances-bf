import {
  assetHintKey,
  caseInsensitive,
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

/**
 * Fiat quote currencies. Trading crypto against fiat is a plain buy/sell
 * for Spanish tax purposes — no second leg needed. Everything else in
 * QUOTE_CURRENCIES (BTC, ETH, BNB, USDT, USDC, DAI, BUSD, TUSD, FDUSD) is
 * treated as a crypto quote → we emit both legs of the swap so the
 * outgoing asset gets disposed FIFO (realising gain/loss vs cost basis in
 * EUR) and the incoming asset gets a new lot at market value. This matches
 * the DGT consultations V0999-18 / V1149-20 on permutas entre criptomonedas.
 */
const FIAT_QUOTE_CURRENCIES = new Set(["EUR", "GBP", "TRY", "BRL", "AUD"]);

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
    const baseAssetHint = { symbol: split.base };
    // Binance fees are dust (cents of BNB per trade) and create heavy
    // bookkeeping overhead — synthetic BNB fee-disposals, noisy tax lots,
    // rounding drift. We intentionally drop them: fees are ignored on the
    // trade itself and no fee-disposal is emitted. The originals remain in
    // rawRow for audit. feeCoin / fee are still parsed above to preserve
    // parser surface but are not propagated.
    void fee;
    void feeCoin;

    const baseFingerprint = makeRowFingerprint({
      source: SOURCE,
      accountHint,
      tradeDate,
      assetHint: assetHintKey(baseAssetHint),
      side,
      quantity: executed.value,
      priceNative: price,
      // Binance CSVs lack a per-fill order id; include the CSV row position so
      // two real partial fills at the same date/price/qty don't collapse to
      // the same fingerprint. Binance exports are order-stable across re-runs.
      rowIndex: idx,
    });
    out.push({
      kind: "trade",
      source: SOURCE,
      tradeDate,
      accountHint,
      rowFingerprint: baseFingerprint,
      rawRow: rec,
      assetHint: baseAssetHint,
      side,
      quantity: executed.value,
      priceNative: price,
      currency: split.quote,
      fees: null,
    });

    // Crypto-crypto permuta: Binance represents a swap as ONE CSV row, but
    // fiscally it is two events — dispose the outgoing asset, acquire the
    // incoming asset, each valued at EUR market rate that day. Emit the
    // mirror leg so FIFO consumes the quote-side position and a fresh lot
    // is opened for the base side with cost basis in EUR. `priceNative = 1`
    // in the quote currency: `insertTrade` converts via fx_rates[quote] ->
    // EUR, so the EUR value of the quote leg ends up equal to the EUR value
    // of the base leg for that day.
    if (!FIAT_QUOTE_CURRENCIES.has(split.quote)) {
      const quoteQty =
        amount.value ?? (executed.value != null ? executed.value * price : 0);
      if (quoteQty > 0) {
        const quoteSide = side === "buy" ? "sell" : "buy";
        const quoteAssetHint = { symbol: split.quote };
        const quoteFingerprint = makeRowFingerprint({
          source: SOURCE,
          accountHint,
          tradeDate,
          assetHint: assetHintKey(quoteAssetHint),
          side: quoteSide,
          quantity: quoteQty,
          priceNative: 1,
          rowIndex: idx,
        });
        out.push({
          kind: "trade",
          source: SOURCE,
          tradeDate,
          accountHint,
          rowFingerprint: quoteFingerprint,
          rawRow: rec,
          assetHint: quoteAssetHint,
          side: quoteSide,
          quantity: quoteQty,
          priceNative: 1,
          currency: split.quote,
          fees: null,
        });
      }
    }
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

