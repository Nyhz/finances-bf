import { createHash } from "node:crypto";
import type { AssetHint, ImportSource } from "./types";

/**
 * Minimal RFC-4180-ish CSV parser. Handles quoted fields, escaped quotes,
 * CR/LF, and trailing newlines. Returns rows of trimmed-of-BOM strings.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  // Strip UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      cur.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((f) => f.length > 0));
}

export function rowsToObjects(
  rows: string[][],
): { header: string[]; records: Record<string, string>[] } {
  if (rows.length === 0) return { header: [], records: [] };
  const header = rows[0].map((h) => h.trim());
  const records: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rec: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      rec[header[j]] = (row[j] ?? "").trim();
    }
    records.push(rec);
  }
  return { header, records };
}

/**
 * Stable, deterministic fingerprint for a parsed row.
 * Truncated SHA-256 hex (16 chars). Same input → same output.
 *
 * Per SPEC §5.4: hash of (source, accountHint, tradeDate, assetHint||'',
 * side||'', quantity||'', priceNative||'', amountNative||'').
 */
export function makeRowFingerprint(input: {
  source: ImportSource;
  accountHint?: string | null;
  tradeDate: string;
  assetHint?: string | null;
  side?: string | null;
  quantity?: number | null;
  priceNative?: number | null;
  amountNative?: number | null;
}): string {
  const parts = [
    input.source,
    input.accountHint ?? "",
    input.tradeDate,
    input.assetHint ?? "",
    input.side ?? "",
    formatNumber(input.quantity),
    formatNumber(input.priceNative),
    formatNumber(input.amountNative),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  // Normalise to a stable string representation. Strip trailing zeros.
  // Use toFixed with enough precision to avoid 0.1+0.2 noise, then trim.
  const s = n.toFixed(10);
  return s.replace(/\.?0+$/, "");
}

/** Pick the most stable identifier from an asset hint (ISIN > symbol > name). */
export function assetHintKey(hint: AssetHint | null | undefined): string {
  if (!hint) return "";
  return hint.isin || hint.symbol || hint.name || "";
}

/**
 * Parse a number that may use European decimal separator (comma) or
 * thousand separators. Returns null when the value is empty/non-numeric.
 */
export function parseDecimal(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "") return null;
  // Remove currency symbols, spaces, and thousand separators heuristically.
  // Strategy: if both '.' and ',' present, assume the rightmost is the decimal.
  let cleaned = s.replace(/[^\d.,\-+]/g, "");
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    // Only comma → decimal separator.
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Strip non-numeric suffix like "0.5BTC" → 0.5. */
export function parseNumericPrefix(raw: string | undefined | null): {
  value: number | null;
  unit: string | null;
} {
  if (raw == null) return { value: null, unit: null };
  const s = raw.trim();
  if (s === "") return { value: null, unit: null };
  const match = s.match(/^([\d.,\-+]+)\s*([A-Za-z]{0,10})\s*$/);
  if (!match) return { value: parseDecimal(s), unit: null };
  return {
    value: parseDecimal(match[1]),
    unit: match[2] ? match[2].toUpperCase() : null,
  };
}

/** Convert "DD-MM-YYYY" or "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" to ISO date. */
export function normaliseDate(raw: string): string | null {
  const s = raw.trim();
  if (s === "") return null;
  // ISO yyyy-mm-dd[ ...]
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // d(d)-m(m)-yyyy or d(d)/m(m)/yyyy
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    return `${dmy[3]}-${month}-${day}`;
  }
  return null;
}
