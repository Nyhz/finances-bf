import {
  assetHintKey,
  makeRowFingerprint,
  normaliseDate,
  parseCsv,
  parseDecimal,
  rowsToObjects,
} from "./_shared";
import type {
  ImportParseError,
  ImportParseResult,
  ParsedImportRow,
} from "./types";

const SOURCE = "degiro" as const;

/**
 * Parses a DeGiro CSV export.
 *
 * Recognised columns (header is case-insensitive, extra columns ignored):
 * Date, Time, Product, ISIN, Venue, Quantity, Price, Currency, Local value,
 * Value, Exchange rate, Transaction costs, Total, Order ID.
 *
 * - Rows with a non-zero Quantity become trades; side is derived from the
 *   sign of Quantity.
 * - Rows without a Quantity become cash movements; the kind is inferred from
 *   the Product description (Dividend / Deposit / Withdrawal / Fee).
 */
export function parseDegiroCsv(csv: string): ImportParseResult {
  const rows = parseCsv(csv);
  if (rows.length === 0) return { source: SOURCE, rows: [], errors: [] };

  const header = rows[0].map((h) => h.trim());
  // Newer DEGIRO "Transactions" export has two *unnamed* columns for the
  // native currency (one after Price, one after Local value) and EUR-tagged
  // fee/value columns. Detect by presence of those EUR-specific headers.
  const isNewFormat =
    header.includes("Value EUR") || header.includes("Total EUR");

  const out: ParsedImportRow[] = [];
  const errors: ImportParseError[] = [];

  if (isNewFormat) {
    parseNewFormat(rows, out, errors);
  } else {
    parseLegacyFormat(rows, out, errors);
  }

  return { source: SOURCE, rows: out, errors };
}

function idx(header: string[], name: string): number {
  return header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
}

function parseNewFormat(
  rows: string[][],
  out: ParsedImportRow[],
  errors: ImportParseError[],
): void {
  const header = rows[0].map((h) => h.trim());
  const iDate = idx(header, "Date");
  const iProduct = idx(header, "Product");
  const iIsin = idx(header, "ISIN");
  const iQty = idx(header, "Quantity");
  const iPrice = idx(header, "Price");
  const iLocalValue = idx(header, "Local value");
  const iValueEur = idx(header, "Value EUR");
  const iExchangeRate = idx(header, "Exchange rate");
  const iAutoFx = idx(header, "AutoFX Fee");
  const iTxFee = header.findIndex((h) =>
    /transaction.*fees.*eur/i.test(h.toLowerCase()),
  );
  const iTotalEur = idx(header, "Total EUR");
  // Unnamed columns between Price/Local value and Local value/Value EUR carry
  // the native currency label. Locate the first empty header following each.
  const iPriceCcy = findNextEmpty(header, iPrice);
  const iLocalValueCcy = findNextEmpty(header, iLocalValue);

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 0 || row.every((c) => c.trim() === "")) continue;
    const get = (i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

    const dateRaw = get(iDate);
    const tradeDate = dateRaw ? normaliseDate(dateRaw) : null;
    if (!tradeDate) {
      errors.push({
        rowIndex: r - 1,
        message: `Missing or unparseable Date: "${dateRaw}"`,
        rawRow: recordFrom(header, row),
      });
      continue;
    }

    const product = get(iProduct);
    const isin = get(iIsin) || null;
    const quantity = parseDecimal(get(iQty));
    const price = parseDecimal(get(iPrice));
    const priceCurrency = (get(iPriceCcy) || "EUR").toUpperCase();
    const localValue = parseDecimal(get(iLocalValue));
    const localValueCcy = (get(iLocalValueCcy) || priceCurrency).toUpperCase();
    const valueEur = parseDecimal(get(iValueEur));
    const exchangeRate = parseDecimal(get(iExchangeRate));
    const autoFxFee = parseDecimal(get(iAutoFx));
    const txFeeEur = parseDecimal(get(iTxFee));
    const totalEur = parseDecimal(get(iTotalEur));
    const rec = recordFrom(header, row);

    if (quantity != null && quantity !== 0 && price != null) {
      const side = quantity > 0 ? "buy" : "sell";
      const absQty = Math.abs(quantity);
      const assetHint = { isin, name: product || null };
      // Prefer the row's own fx (Value EUR / Local value) when both are
      // present; fall back to the published Exchange rate. exchangeRate is
      // native-per-EUR (e.g. 1.1766 USD per EUR) → rateToEur = 1/er.
      let fxRateToEur: number | null = null;
      if (
        valueEur != null &&
        localValue != null &&
        localValue !== 0 &&
        localValueCcy !== "EUR"
      ) {
        fxRateToEur = Math.abs(valueEur / localValue);
      } else if (exchangeRate && exchangeRate > 0 && priceCurrency !== "EUR") {
        fxRateToEur = 1 / exchangeRate;
      } else if (priceCurrency === "EUR") {
        fxRateToEur = 1;
      }

      const feesEur =
        (autoFxFee != null ? Math.abs(autoFxFee) : 0) +
        (txFeeEur != null ? Math.abs(txFeeEur) : 0);
      const assetHintKeyStr = assetHintKey(assetHint);
      const fingerprint = makeRowFingerprint({
        source: SOURCE,
        accountHint: null,
        tradeDate,
        assetHint: assetHintKeyStr,
        side,
        quantity: absQty,
        priceNative: price,
      });
      out.push({
        kind: "trade",
        source: SOURCE,
        tradeDate,
        accountHint: null,
        rowFingerprint: fingerprint,
        rawRow: rec,
        assetHint,
        side,
        quantity: absQty,
        priceNative: price,
        currency: priceCurrency,
        fees: feesEur > 0 ? feesEur : null,
        fxRateToEurOverride: fxRateToEur,
        feesAlreadyEur: true,
      });
      continue;
    }

    // Cash-movement branch (no quantity / no price).
    const movement = classifyMovement(product);
    if (!movement) {
      errors.push({
        rowIndex: r - 1,
        message: `Unrecognised cash movement: "${product}"`,
        rawRow: rec,
      });
      continue;
    }
    const amount = totalEur ?? valueEur ?? txFeeEur;
    if (amount == null) {
      errors.push({
        rowIndex: r - 1,
        message: "Cash movement row missing Total EUR",
        rawRow: rec,
      });
      continue;
    }
    const assetHint = isin || product ? { isin, name: product || null } : null;
    const fingerprint = makeRowFingerprint({
      source: SOURCE,
      accountHint: null,
      tradeDate,
      assetHint: assetHint ? assetHintKey(assetHint) : "",
      side: movement,
      amountNative: amount,
    });
    out.push({
      kind: "cash_movement",
      source: SOURCE,
      tradeDate,
      accountHint: null,
      rowFingerprint: fingerprint,
      rawRow: rec,
      movement,
      amountNative: amount,
      currency: "EUR",
      assetHint,
    });
  }
}

function findNextEmpty(header: string[], start: number): number {
  if (start < 0) return -1;
  for (let i = start + 1; i < header.length; i++) {
    if (header[i].trim() === "") return i;
  }
  return -1;
}

function recordFrom(header: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < header.length; i++) {
    const key = header[i].trim();
    if (!key) continue;
    out[key] = (row[i] ?? "").trim();
  }
  return out;
}

function parseLegacyFormat(
  rows: string[][],
  out: ParsedImportRow[],
  errors: ImportParseError[],
): void {
  const { records } = rowsToObjects(rows);

  records.forEach((rec, idx) => {
    const lookup = caseInsensitive(rec);
    const dateRaw = lookup("Date");
    const tradeDate = dateRaw ? normaliseDate(dateRaw) : null;
    if (!tradeDate) {
      errors.push({
        rowIndex: idx,
        message: `Missing or unparseable Date: "${dateRaw ?? ""}"`,
        rawRow: rec,
      });
      return;
    }

    const accountHint = lookup("Account") || null;
    const product = lookup("Product");
    const isin = lookup("ISIN") || null;
    const currency = (lookup("Currency") || "EUR").toUpperCase();
    const quantity = parseDecimal(lookup("Quantity"));
    const price = parseDecimal(lookup("Price"));
    const total = parseDecimal(lookup("Total"));
    const txnCosts = parseDecimal(lookup("Transaction costs"));

    if (quantity != null && quantity !== 0) {
      if (price == null) {
        errors.push({
          rowIndex: idx,
          message: "Trade row missing Price",
          rawRow: rec,
        });
        return;
      }
      const side = quantity > 0 ? "buy" : "sell";
      const absQty = Math.abs(quantity);
      const fees = txnCosts != null ? Math.abs(txnCosts) : null;
      const assetHint = { isin, name: product || null };
      const fingerprint = makeRowFingerprint({
        source: SOURCE,
        accountHint,
        tradeDate,
        assetHint: assetHintKey(assetHint),
        side,
        quantity: absQty,
        priceNative: price,
      });
      out.push({
        kind: "trade",
        source: SOURCE,
        tradeDate,
        accountHint,
        rowFingerprint: fingerprint,
        rawRow: rec,
        assetHint,
        side,
        quantity: absQty,
        priceNative: price,
        currency,
        fees,
      });
      return;
    }

    const movement = classifyMovement(product);
    if (!movement) {
      errors.push({
        rowIndex: idx,
        message: `Unrecognised cash movement: "${product}"`,
        rawRow: rec,
      });
      return;
    }
    const amount = total ?? txnCosts;
    if (amount == null) {
      errors.push({
        rowIndex: idx,
        message: "Cash movement row missing Total",
        rawRow: rec,
      });
      return;
    }
    const assetHint = isin || product ? { isin, name: product || null } : null;
    const fingerprint = makeRowFingerprint({
      source: SOURCE,
      accountHint,
      tradeDate,
      assetHint: assetHint ? assetHintKey(assetHint) : "",
      side: movement,
      amountNative: amount,
    });
    out.push({
      kind: "cash_movement",
      source: SOURCE,
      tradeDate,
      accountHint,
      rowFingerprint: fingerprint,
      rawRow: rec,
      movement,
      amountNative: amount,
      currency,
      assetHint,
    });
  });
}

function classifyMovement(
  product: string,
):
  | "deposit"
  | "withdrawal"
  | "dividend"
  | "interest"
  | "fee"
  | null {
  const p = product.toLowerCase();
  if (!p) return null;
  if (p.includes("dividend")) return "dividend";
  if (p.includes("interest") || p.includes("interés")) return "interest";
  if (p.includes("deposit") || p.includes("ingreso")) return "deposit";
  if (p.includes("withdraw")) return "withdrawal";
  if (
    p.includes("fee") ||
    p.includes("cost") ||
    p.includes("commission") ||
    p.includes("conversion")
  ) {
    return "fee";
  }
  return null;
}

function caseInsensitive(rec: Record<string, string>) {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(rec)) map.set(k.toLowerCase(), v);
  return (key: string) => map.get(key.toLowerCase()) ?? "";
}
