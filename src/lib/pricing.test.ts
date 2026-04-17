import { describe, expect, it } from "vitest";
import * as pricing from "./pricing";

describe("pricing module shape", () => {
  it("exports fetchQuote and fetchHistory as async functions", () => {
    expect(typeof pricing.fetchQuote).toBe("function");
    expect(typeof pricing.fetchHistory).toBe("function");
  });

  it("fetchQuote rejects with a not-implemented marker (stubbed for future mission)", async () => {
    await expect(pricing.fetchQuote("AAPL")).rejects.toThrow(/not implemented/);
  });

  it("fetchHistory rejects with a not-implemented marker", async () => {
    await expect(
      pricing.fetchHistory("AAPL", new Date("2026-01-01"), new Date("2026-02-01")),
    ).rejects.toThrow(/not implemented/);
  });
});
