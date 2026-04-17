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
  const { records } = rowsToObjects(rows);
  const out: ParsedImportRow[] = [];
  const errors: ImportParseError[] = [];

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

    // Cash movement branch.
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

  return { source: SOURCE, rows: out, errors };
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
