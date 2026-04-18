import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  process.env.COINGECKO_API_KEY = "test-demo-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return impl(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("pricing/coingecko", () => {
  it("fetchQuote returns EUR price and attaches the demo api key header", async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ binancecoin: { eur: 543.21, last_updated_at: 1700000000 } }),
    );
    const { fetchQuote } = await import("./coingecko");
    const q = await fetchQuote("binancecoin");
    expect(q).toEqual({
      symbol: "binancecoin",
      price: 543.21,
      currency: "EUR",
      asOf: new Date(1700000000 * 1000),
    });
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toMatch(/\/simple\/price\?ids=binancecoin/);
    expect((call[1] as RequestInit).headers).toMatchObject({
      "x-cg-demo-api-key": "test-demo-key",
    });
  });

  it("fetchQuote throws when the response has no eur price", async () => {
    stubFetch(() => jsonResponse({}));
    const { fetchQuote } = await import("./coingecko");
    await expect(fetchQuote("missing-id")).rejects.toThrow(/no EUR price/);
  });

  it("fetchHistory downsamples to one row per ISO date and sorts ascending", async () => {
    stubFetch(() =>
      jsonResponse({
        prices: [
          [Date.UTC(2026, 0, 1, 0, 0) , 100],
          [Date.UTC(2026, 0, 1, 23, 59), 110], // same day, keep last
          [Date.UTC(2026, 0, 3, 12, 0), 120],
          [Date.UTC(2026, 0, 2, 6, 0), 105],
        ],
      }),
    );
    const { fetchHistory } = await import("./coingecko");
    const bars = await fetchHistory(
      "ethereum",
      new Date(Date.UTC(2026, 0, 1)),
      new Date(Date.UTC(2026, 0, 4)),
    );
    expect(bars).toEqual([
      { date: "2026-01-01", close: 110, currency: "EUR" },
      { date: "2026-01-02", close: 105, currency: "EUR" },
      { date: "2026-01-03", close: 120, currency: "EUR" },
    ]);
  });

  it("searchCoins maps /search results and uppercases symbols", async () => {
    stubFetch(() =>
      jsonResponse({
        coins: [
          {
            id: "pepe",
            symbol: "pepe",
            name: "Pepe",
            market_cap_rank: 42,
            thumb: "x.png",
          },
          {
            id: "pepe-fork",
            symbol: "pepe",
            name: "Pepe Fork",
            market_cap_rank: null,
          },
        ],
      }),
    );
    const { searchCoins } = await import("./coingecko");
    const out = await searchCoins("pepe");
    expect(out).toEqual([
      { id: "pepe", symbol: "PEPE", name: "Pepe", marketCapRank: 42, thumb: "x.png" },
      { id: "pepe-fork", symbol: "PEPE", name: "Pepe Fork", marketCapRank: null, thumb: null },
    ]);
  });

  it("surfaces HTTP errors with status and body snippet", async () => {
    stubFetch(() => new Response("rate limited", { status: 429 }));
    const { fetchQuote } = await import("./coingecko");
    await expect(fetchQuote("ethereum")).rejects.toThrow(/429.*rate limited/);
  });
});
