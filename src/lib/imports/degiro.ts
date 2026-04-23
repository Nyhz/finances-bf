import { createHash } from "node:crypto";
import { normaliseDate, parseCsv } from "./_shared";

// DEGIRO is always European locale: '.' = thousands, ',' = decimal. The generic
// parseDecimal in _shared.ts can't disambiguate "2.250" (2250 in EU, 2.25 in US),
// so we parse strictly here.
function parseDecimal(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "") return null;
  const cleaned = s.replace(/[^\d,\-+.]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
import { countryFromIsin } from "../../server/tax/countries";
import type {
  ImportParseError,
  ImportParseResult,
  ParsedDividendRow,
  ParsedImportRow,
  ParsedTradeRow,
} from "./types";

const SOURCE = "degiro" as const;

// ── Column indices (0-based) ────────────────────────────────────────────────
// Header: Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id
// idx:    0     1     2          3        4     5            6   7(ccy) 8(amt)  9(ccy) 10(amt)  11
const COL_DATE = 0;
const COL_TIME = 1;
const COL_VALUE_DATE = 2;
const COL_PRODUCT = 3;
const COL_ISIN = 4;
const COL_DESC = 5;
const COL_FX = 6;
const COL_CHANGE_CCY = 7;
const COL_CHANGE_AMT = 8;
const COL_BALANCE_CCY = 9;
const COL_BALANCE_AMT = 10;
const COL_ORDER_ID = 11;

// ── Row classification ──────────────────────────────────────────────────────
type RowClass =
  | "trade"
  | "trade-fee"
  | "trade-fx"
  | "dividend-gross"
  | "dividend-wht-origen"
  | "dividend-wht-destino"
  | "dividend-fx"
  | "suppressed"
  | "unknown";

const SUPPRESS_PREFIXES = [
  "adr/gdr",
  "flatex deposit",
  "flatex interest income",
  "degiro cash sweep transfer",
  "transferir ",
  "comisión de conectividad",
];

function classifyRow(desc: string, orderId: string): RowClass {
  const d = desc.trim().toLowerCase();

  // Check suppressed first (exact match for bare "ingreso")
  if (d === "ingreso") return "suppressed";

  // Suppress by prefix
  for (const prefix of SUPPRESS_PREFIXES) {
    if (d.startsWith(prefix)) return "suppressed";
  }

  // Trades
  if (d.startsWith("compra ") || d.startsWith("venta ")) return "trade";

  // Transaction fee
  if (d.startsWith("costes de transacción") && orderId.trim() !== "") {
    return "trade-fee";
  }

  // FX change rows — distinguish by OrderId
  if (
    d.startsWith("ingreso cambio de divisa") ||
    d.startsWith("retirada cambio de divisa")
  ) {
    return orderId.trim() !== "" ? "trade-fx" : "dividend-fx";
  }

  // Dividends
  if (d.startsWith("dividendo")) return "dividend-gross";
  if (d.startsWith("retención del dividendo")) return "dividend-wht-origen";
  if (d.startsWith("impuesto sobre dividendo")) return "dividend-wht-destino";

  return "unknown";
}

// ── Parsed raw row ──────────────────────────────────────────────────────────
type RawParsedRow = {
  rowIndex: number; // 1-based (header = 0)
  date: string; // raw DD-MM-YYYY
  time: string;
  valueDate: string;
  product: string;
  isin: string;
  desc: string;
  fx: string; // FX column (may be empty)
  changeCcy: string;
  changeAmt: string;
  balanceCcy: string;
  balanceAmt: string;
  orderId: string;
  class: RowClass;
  // Parsed conveniences
  isoDate: string | null;
  changeAmtNum: number | null;
  fxNum: number | null;
};

// ── Fingerprint ─────────────────────────────────────────────────────────────
function makeFingerprintFromRaw(row: RawParsedRow): string {
  const parts = [
    row.date,
    row.time,
    row.valueDate,
    row.isin,
    row.desc,
    row.changeAmt,
    row.changeCcy,
    row.balanceAmt,
  ];
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

// ── Main parse ───────────────────────────────────────────────────────────────
export function parseDegiroCsv(csv: string): ImportParseResult {
  const allRows = parseCsv(csv);
  if (allRows.length === 0) return { source: SOURCE, rows: [], errors: [] };

  const out: ParsedImportRow[] = [];
  const errors: ImportParseError[] = [];

  const rawRows: RawParsedRow[] = [];

  for (let r = 1; r < allRows.length; r++) {
    const row = allRows[r];
    if (row.every((c) => c.trim() === "")) continue;

    const get = (i: number) => (row[i] ?? "").trim();
    const date = get(COL_DATE);
    const time = get(COL_TIME);
    const valueDate = get(COL_VALUE_DATE);
    const product = get(COL_PRODUCT);
    const isin = get(COL_ISIN);
    const desc = get(COL_DESC);
    const fx = get(COL_FX);
    const changeCcy = get(COL_CHANGE_CCY);
    const changeAmt = get(COL_CHANGE_AMT);
    const balanceCcy = get(COL_BALANCE_CCY);
    const balanceAmt = get(COL_BALANCE_AMT);
    const orderId = get(COL_ORDER_ID);

    const cls = classifyRow(desc, orderId);
    const isoDate = date ? normaliseDate(date) : null;
    const changeAmtNum = parseDecimal(changeAmt);
    const fxNum = fx ? parseDecimal(fx) : null;

    rawRows.push({
      rowIndex: r,
      date,
      time,
      valueDate,
      product,
      isin,
      desc,
      fx,
      changeCcy,
      changeAmt,
      balanceCcy,
      balanceAmt,
      orderId,
      class: cls,
      isoDate,
      changeAmtNum,
      fxNum,
    });
  }

  // ── Collect unknown rows as errors ────────────────────────────────────────
  for (const r of rawRows) {
    if (r.class === "unknown") {
      errors.push({
        rowIndex: r.rowIndex,
        message: `Unrecognised row description: "${r.desc}"`,
        rawRow: makeRawRowRecord(r),
      });
    }
  }

  // ── Assemble trades by OrderId ────────────────────────────────────────────
  const tradeRowsByOrder = new Map<string, RawParsedRow[]>();
  for (const r of rawRows) {
    const oid = r.orderId;
    if (
      oid &&
      (r.class === "trade" ||
        r.class === "trade-fee" ||
        r.class === "trade-fx")
    ) {
      if (!tradeRowsByOrder.has(oid)) tradeRowsByOrder.set(oid, []);
      tradeRowsByOrder.get(oid)!.push(r);
    }
  }

  for (const [orderId, group] of tradeRowsByOrder) {
    const tradeRow = group.find((r) => r.class === "trade");
    if (!tradeRow) {
      errors.push({
        rowIndex: group[0].rowIndex,
        message: `OrderId ${orderId}: no trade row found in group`,
        rawRow: makeRawRowRecord(group[0]),
      });
      continue;
    }

    const parsed = parseTradeDescription(tradeRow.desc);
    if (!parsed) {
      errors.push({
        rowIndex: tradeRow.rowIndex,
        message: `Cannot parse trade description: "${tradeRow.desc}"`,
        rawRow: makeRawRowRecord(tradeRow),
      });
      continue;
    }

    const tradeDate = tradeRow.isoDate;
    if (!tradeDate) {
      errors.push({
        rowIndex: tradeRow.rowIndex,
        message: `Missing date on trade row`,
        rawRow: makeRawRowRecord(tradeRow),
      });
      continue;
    }

    // Fee
    const feeRow = group.find((r) => r.class === "trade-fee");
    const fees = feeRow?.changeAmtNum != null ? Math.abs(feeRow.changeAmtNum) : null;

    // FX rate for non-EUR trades
    let fxRateToEurOverride: number | null = null;
    if (parsed.currency !== "EUR") {
      const fxRows = group.filter((r) => r.class === "trade-fx");
      fxRateToEurOverride = deriveFxRate(fxRows, parsed.currency);
    }

    const side = parsed.side;
    const assetHint = {
      isin: tradeRow.isin || parsed.isin || null,
      name: tradeRow.product || null,
    };

    const fingerprint = makeFingerprintFromRaw(tradeRow);

    const tradeEmit: ParsedTradeRow = {
      kind: "trade",
      source: SOURCE,
      tradeDate,
      accountHint: null,
      rowFingerprint: fingerprint,
      rawRow: makeRawRowRecord(tradeRow),
      assetHint,
      side,
      quantity: parsed.quantity,
      priceNative: parsed.price,
      currency: parsed.currency,
      fees,
      feesAlreadyEur: true,
      fxRateToEurOverride,
    };
    out.push(tradeEmit);
  }

  // ── Assemble dividends ───────────────────────────────────────────────────
  const dividendGrossRows = rawRows.filter((r) => r.class === "dividend-gross");
  const whtOrigenRows = rawRows.filter((r) => r.class === "dividend-wht-origen");
  const whtDestinoRows = rawRows.filter((r) => r.class === "dividend-wht-destino");
  const divFxRows = rawRows.filter((r) => r.class === "dividend-fx");

  for (const divRow of dividendGrossRows) {
    const tradeDate = divRow.isoDate;
    if (!tradeDate) {
      errors.push({
        rowIndex: divRow.rowIndex,
        message: `Missing date on dividend row`,
        rawRow: makeRawRowRecord(divRow),
      });
      continue;
    }

    const isin = divRow.isin;
    const grossNative = divRow.changeAmtNum != null ? Math.abs(divRow.changeAmtNum) : 0;
    const currency = divRow.changeCcy || "EUR";

    // Match withholding origen: same ISIN, |date diff| ≤ 3 days
    const whtOrigen = findClosestByIsin(whtOrigenRows, isin, tradeDate, 3);
    const withholdingOrigenNative = whtOrigen?.changeAmtNum != null
      ? Math.abs(whtOrigen.changeAmtNum)
      : 0;

    // Match withholding destino: same ISIN, |date diff| ≤ 3 days
    const whtDestino = findClosestByIsin(whtDestinoRows, isin, tradeDate, 3);
    const withholdingDestinoEur = whtDestino?.changeAmtNum != null
      ? Math.abs(whtDestino.changeAmtNum)
      : null;

    // FX rate for dividend
    let fxRateToEurOverride: number | null = null;
    if (currency !== "EUR") {
      // Find dividend-fx rows near this dividend date (within ±5 days) and same currency
      const nearFxRows = divFxRows.filter((r) => {
        if (!r.isoDate) return false;
        return Math.abs(dateDiffDays(r.isoDate, tradeDate)) <= 5;
      });
      fxRateToEurOverride = deriveFxRate(nearFxRows, currency);
    }

    const sourceCountry = isin ? countryFromIsin(isin) : null;

    const fingerprint = makeFingerprintFromRaw(divRow);

    const divEmit: ParsedDividendRow = {
      kind: "dividend",
      source: SOURCE,
      tradeDate,
      accountHint: null,
      rowFingerprint: fingerprint,
      rawRow: makeRawRowRecord(divRow),
      assetHint: {
        isin: isin || null,
        name: divRow.product || null,
      },
      grossNative,
      currency,
      fxRateToEurOverride,
      withholdingOrigenNative,
      withholdingDestinoEur,
      sourceCountry,
    };
    out.push(divEmit);
  }

  return { source: SOURCE, rows: out, errors };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type TradeDescParsed = {
  side: "buy" | "sell";
  quantity: number;
  price: number;
  currency: string;
  isin: string;
};

/**
 * Parse DEGIRO trade descriptions like:
 *   "Compra 3 UnitedHealth Group Inc@309,98 USD (US91324P1021)"
 *   "Venta 18 ADR on JD.com Inc Class A@33,75 USD (US47215P1066)"
 *   "Compra 2.250 Amper SA@0,144 EUR (ES0109260531)"
 */
function parseTradeDescription(desc: string): TradeDescParsed | null {
  // Match: (Compra|Venta) <qty> <name>@<price> <CCY> (<ISIN>)
  const m = desc.match(
    /^(Compra|Venta)\s+([\d.,]+)\s+.+?@([\d.,]+)\s+([A-Z]{3})\s+\(([A-Z0-9]{12})\)/i,
  );
  if (!m) return null;

  const side: "buy" | "sell" = m[1].toLowerCase() === "compra" ? "buy" : "sell";
  const quantity = parseDecimal(m[2]);
  const price = parseDecimal(m[3]);
  const currency = m[4].toUpperCase();
  const isin = m[5].toUpperCase();

  if (quantity == null || price == null) return null;
  return { side, quantity: Math.abs(quantity), price, currency, isin };
}

/**
 * Derive EUR/native FX rate from a set of FX rows.
 * Strategy:
 *  1. Find the EUR leg (changeCcy === "EUR") and native leg (changeCcy === nativeCcy).
 *  2. fxRate = |EUR amount| / |native amount| (EUR per 1 native unit).
 *  3. If only one leg present and it has an fxNum (the FX column),
 *     interpret FX column as native-per-EUR → fxRate = 1/FX.
 */
function deriveFxRate(fxRows: RawParsedRow[], nativeCcy: string): number | null {
  if (fxRows.length === 0) return null;

  const eurLeg = fxRows.find((r) => r.changeCcy === "EUR");
  const nativeLeg = fxRows.find((r) => r.changeCcy === nativeCcy);

  if (eurLeg?.changeAmtNum != null && nativeLeg?.changeAmtNum != null && nativeLeg.changeAmtNum !== 0) {
    return Math.abs(eurLeg.changeAmtNum) / Math.abs(nativeLeg.changeAmtNum);
  }

  // Fall back to FX column on either leg
  const legWithFx = fxRows.find((r) => r.fxNum != null && r.fxNum > 0);
  if (legWithFx?.fxNum) {
    // FX column = native-per-EUR → EUR/native = 1/FX
    return 1 / legWithFx.fxNum;
  }

  return null;
}

/**
 * Find the closest row (by ISIN match, within maxDays) in a list of candidate rows.
 */
function findClosestByIsin(
  candidates: RawParsedRow[],
  isin: string,
  refDate: string,
  maxDays: number,
): RawParsedRow | undefined {
  let best: RawParsedRow | undefined;
  let bestDiff = Infinity;

  for (const c of candidates) {
    if (c.isin !== isin || !c.isoDate) continue;
    const diff = Math.abs(dateDiffDays(c.isoDate, refDate));
    if (diff <= maxDays && diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return best;
}

function dateDiffDays(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return (da - db) / (1000 * 60 * 60 * 24);
}

function makeRawRowRecord(r: RawParsedRow): Record<string, string> {
  return {
    Date: r.date,
    Time: r.time,
    "Value date": r.valueDate,
    Product: r.product,
    ISIN: r.isin,
    Description: r.desc,
    FX: r.fx,
    ChangeCcy: r.changeCcy,
    Change: r.changeAmt,
    BalanceCcy: r.balanceCcy,
    Balance: r.balanceAmt,
    "Order Id": r.orderId,
  };
}
