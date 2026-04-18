import { toIsoDate } from "../fx";
import type { CoinCandidate, HistoricalBar, Quote } from "./types";

const BASE_URL = "https://api.coingecko.com/api/v3";

function authHeaders(): Record<string, string> {
  const key = process.env.COINGECKO_API_KEY;
  const base: Record<string, string> = { accept: "application/json" };
  if (key && key.trim()) base["x-cg-demo-api-key"] = key.trim();
  return base;
}

async function cgFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: authHeaders(),
    // Avoid Next's fetch cache for pricing calls.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `coingecko ${res.status} ${res.statusText} for ${path}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }
  return (await res.json()) as T;
}

/**
 * `symbol` here is expected to be a CoinGecko coin id (e.g. "binancecoin"),
 * stored on `asset.providerSymbol` for crypto assets. Returns the EUR price.
 */
export async function fetchQuote(symbol: string): Promise<Quote> {
  const id = symbol.trim().toLowerCase();
  const data = await cgFetch<Record<string, { eur?: number; last_updated_at?: number }>>(
    `/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=eur&include_last_updated_at=true`,
  );
  const row = data[id];
  if (!row || row.eur == null || !Number.isFinite(row.eur)) {
    throw new Error(`coingecko fetchQuote: no EUR price for "${id}"`);
  }
  const asOf = row.last_updated_at
    ? new Date(row.last_updated_at * 1000)
    : new Date();
  return { symbol: id, price: row.eur, currency: "EUR", asOf };
}

/**
 * Daily-close history. CoinGecko returns an array of [unix_ms, price] tuples.
 * For ranges > 90 days the API auto-selects daily granularity; within 90 days
 * it returns hourly points, which we downsample to one point per date.
 */
export async function fetchHistory(
  symbol: string,
  from: Date,
  to: Date,
): Promise<HistoricalBar[]> {
  const id = symbol.trim().toLowerCase();
  const fromUnix = Math.floor(from.getTime() / 1000);
  const toUnix = Math.floor(to.getTime() / 1000);
  const data = await cgFetch<{ prices?: Array<[number, number]> }>(
    `/coins/${encodeURIComponent(id)}/market_chart/range?vs_currency=eur&from=${fromUnix}&to=${toUnix}`,
  );
  const prices = data.prices ?? [];
  const byDate = new Map<string, number>();
  for (const [ms, price] of prices) {
    if (!Number.isFinite(price)) continue;
    const iso = toIsoDate(new Date(ms));
    // Keep the last observation of each date (latest close).
    byDate.set(iso, price);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, close]) => ({ date, close, currency: "EUR" }));
}

/**
 * Symbol → coin candidate lookup. Used by the import picker so the user can
 * pick which CoinGecko coin an ambiguous ticker (e.g. PEPE) maps to.
 */
export async function searchCoins(query: string): Promise<CoinCandidate[]> {
  const q = query.trim();
  if (!q) return [];
  const data = await cgFetch<{
    coins?: Array<{
      id: string;
      symbol: string;
      name: string;
      market_cap_rank?: number | null;
      thumb?: string | null;
    }>;
  }>(`/search?query=${encodeURIComponent(q)}`);
  const coins = data.coins ?? [];
  return coins.map((c) => ({
    id: c.id,
    symbol: (c.symbol ?? "").toUpperCase(),
    name: c.name,
    marketCapRank: c.market_cap_rank ?? null,
    thumb: c.thumb ?? null,
  }));
}
