import {
  assetHintKey,
  caseInsensitive,
  makeRowFingerprint,
  normaliseDate,
  parseCsv,
  parseDecimal,
  rowsToObjects,
} from "./_shared";
import type {
  CashMovementKind,
  ImportParseError,
  ImportParseResult,
  ParsedImportRow,
  TradeSide,
} from "./types";

const SOURCE = "cobas" as const;

/**
 * Parses a Cobas Asset Management fund-statement CSV.
 *
 * Recognised columns: Fecha, Operación, Fondo, ISIN, Participaciones,
 * Valor liquidativo, Importe, Divisa.
 *
 * Operación values:
 * - "Suscripción"        → trade buy
 * - "Reembolso"          → trade sell
 * - "Comisión gestión"   → cash_movement fee
 * - "Dividendo"          → cash_movement dividend
 */
export function parseCobasCsv(csv: string): ImportParseResult {
  const rows = parseCsv(csv);
  const { records } = rowsToObjects(rows);
  const out: ParsedImportRow[] = [];
  const errors: ImportParseError[] = [];

  records.forEach((rec, idx) => {
    const lookup = caseInsensitive(rec);
    const dateRaw = lookup("Fecha");
    const tradeDate = normaliseDate(dateRaw);
    if (!tradeDate) {
      errors.push({
        rowIndex: idx,
        message: `Missing or unparseable Fecha: "${dateRaw}"`,
        rawRow: rec,
      });
      return;
    }
    // Operation type lives in "Tipo" on the current Cobas export;
    // legacy exports used "Operación"/"Operacion". "Operacion" in newer
    // files is a reference id and must not be treated as the operation.
    const operation = lookup("Tipo") || lookup("Operación") || lookup("Operacion");
    const fund = lookup("Producto") || lookup("Fondo");
    const isin = lookup("ISIN") || null;
    const accountHint = lookup("Cuenta") || "cobas";
    const currency = (lookup("Divisa") || "EUR").toUpperCase();
    const participations = parseDecimal(lookup("Participaciones"));
    const nav = parseDecimal(lookup("Valor liquidativo"));
    const amount =
      parseDecimal(lookup("Importe neto")) ??
      parseDecimal(lookup("Importe bruto")) ??
      parseDecimal(lookup("Importe"));
    const assetHint = { isin, name: fund || null };

    const tradeSide = mapTradeSide(operation);
    if (tradeSide) {
      if (participations == null || nav == null) {
        errors.push({
          rowIndex: idx,
          message: `Trade row missing Participaciones or NAV (${operation})`,
          rawRow: rec,
        });
        return;
      }
      const fingerprint = makeRowFingerprint({
        source: SOURCE,
        accountHint,
        tradeDate,
        assetHint: assetHintKey(assetHint),
        side: tradeSide,
        quantity: participations,
        priceNative: nav,
      });
      out.push({
        kind: "trade",
        source: SOURCE,
        tradeDate,
        accountHint,
        rowFingerprint: fingerprint,
        rawRow: rec,
        assetHint,
        side: tradeSide,
        quantity: participations,
        priceNative: nav,
        currency,
        fees: null,
      });
      return;
    }

    const movement = mapCashMovement(operation);
    if (!movement) {
      errors.push({
        rowIndex: idx,
        message: `Unrecognised Operación: "${operation}"`,
        rawRow: rec,
      });
      return;
    }
    if (amount == null) {
      errors.push({
        rowIndex: idx,
        message: `Cash movement row missing Importe (${operation})`,
        rawRow: rec,
      });
      return;
    }
    const fingerprint = makeRowFingerprint({
      source: SOURCE,
      accountHint,
      tradeDate,
      assetHint: assetHintKey(assetHint),
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

function mapTradeSide(op: string): TradeSide | null {
  const o = op.toLowerCase();
  if (o.startsWith("suscrip")) return "buy";
  if (o.startsWith("reembol")) return "sell";
  return null;
}

function mapCashMovement(op: string): CashMovementKind | null {
  const o = op.toLowerCase();
  if (o.includes("comisión") || o.includes("comision") || o.includes("fee")) {
    return "fee";
  }
  if (o.includes("dividendo") || o.includes("dividend")) return "dividend";
  if (o.includes("interés") || o.includes("interes")) return "interest";
  if (o.includes("aporta") || o.includes("ingreso") || o.includes("deposit")) {
    return "deposit";
  }
  if (o.includes("retira") || o.includes("withdraw")) return "withdrawal";
  return null;
}

