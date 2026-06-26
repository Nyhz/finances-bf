// Financial Times (markets.ft.com) client — daily NAV + historical series for
// mutual funds keyed by ISIN, for instruments Yahoo can't price. It exposes a
// full daily history, which is what makes valuation backfill possible.
//
// Same isolation discipline as the other pricing clients: no action/component
// calls FT directly, and tests stub this module — no real network.
//
// FT keys everything by an internal numeric `xid`, but we never store that: the
// price-sync engine hands us the public symbol `ISIN:CURRENCY` (e.g.
// "FR0000989626:EUR"); for history we first resolve the xid off the tearsheet,
// then hit the historical-prices endpoint. The price-history `symbol` column
// stores the `ISIN:CURRENCY` form so the daily sync and the backfill share one
// continuous series.

import { withTimeout } from "./_net";
import type { HistoricalBar, Quote } from "./types";

const ORIGIN = "https://markets.ft.com";
const TEARSHEET_PATH = "/data/funds/tearsheet/summary?s=";
const HISTORY_PATH = "/data/equities/ajax/get-historical-prices";

// FT 403s clients without a browser User-Agent.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// xid is embedded in a data-mod-config blob; quotes are HTML-entity-encoded on
// the tearsheet (&quot;) but plain in some partials — match either.
const XID_RE = /(?:&quot;|")xid(?:&quot;|"):(?:&quot;|")(\d+)/;
// "Price (EUR)</span><span class="mod-ui-data-list__value">44,339.26"
const PRICE_RE =
  /Price \(([A-Za-z]{3})\)<\/span><span class="mod-ui-data-list__value">\s*([\d,]+\.\d+)/;
// "...as of Jun 25 2026."
const ASOF_RE = /as of\s+([A-Za-z]{3,})\s+(\d{1,2})\s+(\d{4})/;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function monthIndex(name: string): number | null {
  const m = MONTHS[name.slice(0, 3).toLowerCase()];
  return m === undefined ? null : m;
}

/** "44,339.26" → 44339.26 — English format: ',' thousands, '.' decimal. */
function parseEnglishNumber(raw: string): number {
  return Number.parseFloat(raw.trim().replace(/,/g, ""));
}

function currencyOf(symbol: string): string {
  const cur = symbol.split(":")[1]?.toUpperCase();
  return cur && /^[A-Z]{3}$/.test(cur) ? cur : "EUR";
}

/** Resolve FT's internal numeric id from a tearsheet page. */
export function extractFtXid(html: string): string | null {
  return html.match(XID_RE)?.[1] ?? null;
}

/** Parse the latest NAV out of an FT fund tearsheet. Throws if absent or
 *  non-positive — a silent bad price would corrupt valuations. */
export function parseFtQuote(html: string, symbol: string): Quote {
  const priceMatch = html.match(PRICE_RE);
  if (!priceMatch) throw new Error(`ft ${symbol}: no price found on tearsheet`);
  const price = parseEnglishNumber(priceMatch[2]);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`ft ${symbol}: unusable price ${JSON.stringify(priceMatch[2])}`);
  }
  const currency = priceMatch[1].toUpperCase();

  const asOfMatch = html.match(ASOF_RE);
  const month = asOfMatch ? monthIndex(asOfMatch[1]) : null;
  const asOf =
    asOfMatch && month != null
      ? new Date(Date.UTC(Number(asOfMatch[3]), month, Number(asOfMatch[2])))
      : new Date();

  return { symbol, price, currency, asOf };
}

const ROW_RE = /<tr>([\s\S]*?)<\/tr>/g;
const ROW_DATE_RE = /([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/;
const ROW_NUM_RE = /<td>\s*([\d,]+\.\d+)\s*<\/td>/g;

/** Parse the historical-prices AJAX JSON into daily close bars. Each row is a
 *  date cell + O/H/L/C cells + volume; we take the close (4th numeric cell). */
export function parseFtHistory(body: string, symbol: string): HistoricalBar[] {
  let html: string;
  try {
    html = (JSON.parse(body) as { html?: string }).html ?? "";
  } catch {
    html = body;
  }
  const currency = currencyOf(symbol);
  const out: HistoricalBar[] = [];
  for (const rowMatch of html.matchAll(ROW_RE)) {
    const row = rowMatch[1];
    const dateMatch = row.match(ROW_DATE_RE);
    if (!dateMatch) continue;
    const month = monthIndex(dateMatch[1]);
    if (month == null) continue;
    const nums = [...row.matchAll(ROW_NUM_RE)].map((m) => parseEnglishNumber(m[1]));
    // O, H, L, C — the close is the 4th. Skip rows that don't carry four.
    if (nums.length < 4) continue;
    const close = nums[3];
    if (!Number.isFinite(close) || close <= 0) continue;
    const yyyy = dateMatch[3];
    const mm = String(month + 1).padStart(2, "0");
    const dd = dateMatch[2].padStart(2, "0");
    out.push({ date: `${yyyy}-${mm}-${dd}`, close, currency });
  }
  return out;
}

async function loadTearsheet(symbol: string): Promise<string> {
  const res = await fetch(`${ORIGIN}${TEARSHEET_PATH}${encodeURIComponent(symbol)}`, {
    headers: { "user-agent": BROWSER_UA },
  });
  if (!res.ok) throw new Error(`ft ${symbol}: tearsheet HTTP ${res.status}`);
  return res.text();
}

/** Latest NAV for one `ISIN:CURRENCY` symbol. */
export async function fetchQuote(symbol: string): Promise<Quote> {
  return withTimeout(
    loadTearsheet(symbol).then((html) => parseFtQuote(html, symbol)),
    undefined,
    `ft quote ${symbol}`,
  );
}

/** Batched quote: FT has no multi-fund endpoint, so fetch each symbol in turn
 *  and skip the ones that fail rather than blanking the whole batch. */
export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  const unique = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  const out: Quote[] = [];
  for (const symbol of unique) {
    try {
      out.push(await fetchQuote(symbol));
    } catch {
      // Skip a fund FT can't price; the rest of the batch survives.
    }
  }
  return out;
}

function ftDate(d: Date): string {
  // FT wants YYYY/MM/DD in the query string.
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function loadHistory(
  symbol: string,
  from: Date,
  to: Date,
): Promise<HistoricalBar[]> {
  const xid = extractFtXid(await loadTearsheet(symbol));
  if (!xid) throw new Error(`ft ${symbol}: could not resolve xid`);
  const url =
    `${ORIGIN}${HISTORY_PATH}?startDate=${ftDate(from)}&endDate=${ftDate(to)}&symbol=${xid}`;
  const res = await fetch(url, {
    headers: { "user-agent": BROWSER_UA, "x-requested-with": "XMLHttpRequest" },
  });
  if (!res.ok) throw new Error(`ft ${symbol}: history HTTP ${res.status}`);
  return parseFtHistory(await res.text(), symbol);
}

/** Daily close bars for one `ISIN:CURRENCY` symbol between two dates. Costs two
 *  requests (tearsheet to resolve the xid, then the historical endpoint). */
export async function fetchHistory(
  symbol: string,
  from: Date,
  to: Date,
): Promise<HistoricalBar[]> {
  return withTimeout(
    loadHistory(symbol, from, to),
    20_000,
    `ft history ${symbol}`,
  );
}
