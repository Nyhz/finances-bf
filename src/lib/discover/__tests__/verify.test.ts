import { describe, expect, it } from "vitest";
import type { HistoricalBar } from "../../pricing/types";
import { verifyCandidate, type VerifyClients } from "../verify";

function bars(closes: number[]): HistoricalBar[] {
  return closes.map((close, i) => ({ date: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`, close, currency: "USD" }));
}

// Build clients from a symbol→closes map; fetchQuote returns the last close.
function clients(map: Record<string, number[]>, sector: string | null = null): VerifyClients {
  return {
    fetchHistory: async (symbol) => {
      if (!(symbol in map)) throw new Error(`no data for ${symbol}`);
      return bars(map[symbol]);
    },
    fetchQuote: async (symbol) => {
      const c = map[symbol];
      return { symbol, price: c[c.length - 1], currency: "USD", asOf: new Date() };
    },
    fetchAssetSector: async () => sector,
  };
}

describe("discover/verify", () => {
  it("below_dma200: confirmed when price is under the 200-day SMA", async () => {
    const closes = Array(250).fill(100);
    for (let i = 240; i < 250; i++) closes[i] = 70; // recent slump, price 70 < ~98.5 SMA
    const v = await verifyCandidate("AAA", "below_dma200", clients({ AAA: closes }));
    expect(v.status).toBe("confirmed");
    expect(v.metrics.dma200).not.toBeNull();
  });

  it("below_dma200: refuted when price is above the SMA", async () => {
    const closes = Array(250).fill(100);
    closes[249] = 130;
    const v = await verifyCandidate("AAA", "below_dma200", clients({ AAA: closes }));
    expect(v.status).toBe("refuted");
  });

  it("below_dma200: unverifiable without enough history for the SMA", async () => {
    const closes = Array(50).fill(100); // ≥30 bars but <200 → no DMA200
    const v = await verifyCandidate("AAA", "below_dma200", clients({ AAA: closes }));
    expect(v.status).toBe("unverifiable");
  });

  it("drawdown_30d: confirmed on a ≥15% fall from the 30-day high", async () => {
    const closes = Array(60).fill(100);
    closes[59] = 80; // −20% from the 30-day high of 100
    const v = await verifyCandidate("AAA", "drawdown_30d", clients({ AAA: closes }));
    expect(v.status).toBe("confirmed");
    expect(v.metrics.drawdown30d).toBeLessThanOrEqual(-0.15);
  });

  it("unverifiable when the symbol has no market data", async () => {
    const v = await verifyCandidate("ZZZ", "below_dma200", clients({ AAA: Array(250).fill(100) }));
    expect(v.status).toBe("unverifiable");
  });

  it("hot_sector_laggard: confirmed when the sector ETF is strong and the stock lags", async () => {
    const ownFlat = Array(80).fill(100); // 3m return ≈ 0
    const etfUp = Array.from({ length: 80 }, (_, i) => 100 + i * (20 / 79)); // ≈ +20% over the window
    const v = await verifyCandidate(
      "AAA",
      "hot_sector_laggard",
      clients({ AAA: ownFlat, XLK: etfUp }, "technology"),
    );
    expect(v.status).toBe("confirmed");
    expect(v.metrics.sector).toBe("technology");
  });

  it("hot_sector_laggard: unverifiable when the sector is unknown", async () => {
    const v = await verifyCandidate(
      "AAA",
      "hot_sector_laggard",
      clients({ AAA: Array(80).fill(100) }, null),
    );
    expect(v.status).toBe("unverifiable");
  });
});
