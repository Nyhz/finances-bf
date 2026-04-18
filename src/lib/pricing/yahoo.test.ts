import { beforeEach, describe, expect, it, vi } from "vitest";

const quoteMock = vi.fn();
const historicalMock = vi.fn();

vi.mock("yahoo-finance2", () => ({
  default: class {
    quote(...args: unknown[]) {
      return quoteMock(...args);
    }
    historical(...args: unknown[]) {
      return historicalMock(...args);
    }
  },
}));

import { fetchHistory, fetchQuote } from "./yahoo";

describe("pricing/yahoo", () => {
  beforeEach(() => {
    quoteMock.mockReset();
    historicalMock.mockReset();
  });

  it("fetchQuote maps yahoo-finance2 quote into a Quote shape", async () => {
    quoteMock.mockResolvedValueOnce({
      regularMarketPrice: 193.5,
      currency: "usd",
      regularMarketTime: new Date("2026-04-18T16:00:00Z"),
    });
    const q = await fetchQuote("AAPL");
    expect(q).toEqual({
      symbol: "AAPL",
      price: 193.5,
      currency: "USD",
      asOf: new Date("2026-04-18T16:00:00Z"),
    });
    expect(quoteMock).toHaveBeenCalledWith("AAPL");
  });

  it("fetchQuote throws when regularMarketPrice is missing", async () => {
    quoteMock.mockResolvedValueOnce({ currency: "USD" });
    await expect(fetchQuote("BROKEN")).rejects.toThrow(/regularMarketPrice/);
  });

  it("fetchHistory filters null closes and formats the date", async () => {
    historicalMock.mockResolvedValueOnce([
      { date: new Date("2026-04-17T00:00:00Z"), close: 190 },
      { date: new Date("2026-04-18T00:00:00Z"), close: null },
    ]);
    const bars = await fetchHistory(
      "AAPL",
      new Date("2026-04-15"),
      new Date("2026-04-19"),
    );
    expect(bars).toEqual([
      { date: "2026-04-17", close: 190, currency: "USD" },
    ]);
  });
});
