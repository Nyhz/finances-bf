import { describe, expect, it, vi } from "vitest";
import { type FxLookup, type FxRateRow, resolveFxRate } from "./fx";

function makeLookup(rows: FxRateRow[]): FxLookup {
  return {
    findOnDate: vi.fn(async (ccy, iso) =>
      rows.find((r) => r.currency === ccy && r.date === iso) ?? null,
    ),
    findLatest: vi.fn(async (ccy, onOrBefore) => {
      const matches = rows
        .filter((r) => r.currency === ccy && (!onOrBefore || r.date <= onOrBefore))
        .sort((a, b) => b.date.localeCompare(a.date));
      return matches[0] ?? null;
    }),
  };
}

describe("resolveFxRate", () => {
  it("short-circuits EUR to 1 without touching the lookup", async () => {
    const lookup = makeLookup([]);
    const result = await resolveFxRate("EUR", "2026-04-17", lookup);
    expect(result).toEqual({ rate: 1, source: "unit" });
    expect(lookup.findOnDate).not.toHaveBeenCalled();
    expect(lookup.findLatest).not.toHaveBeenCalled();
  });

  it("prefers explicit override over lookup", async () => {
    const lookup = makeLookup([
      { currency: "USD", date: "2026-04-17", rateToEur: 0.9 },
    ]);
    const result = await resolveFxRate("USD", "2026-04-17", lookup, {
      explicitRate: 0.85,
    });
    expect(result).toEqual({ rate: 0.85, source: "explicit" });
    expect(lookup.findOnDate).not.toHaveBeenCalled();
  });

  it("uses historical rate when available for the date", async () => {
    const lookup = makeLookup([
      { currency: "USD", date: "2026-04-17", rateToEur: 0.92 },
    ]);
    const result = await resolveFxRate("USD", "2026-04-17", lookup);
    expect(result).toEqual({ rate: 0.92, source: "historical" });
  });

  it("falls back to latest with stale=true when date missing", async () => {
    const lookup = makeLookup([
      { currency: "USD", date: "2026-04-10", rateToEur: 0.91 },
      { currency: "USD", date: "2026-04-01", rateToEur: 0.88 },
    ]);
    const result = await resolveFxRate("USD", "2026-04-17", lookup);
    expect(result).toEqual({ rate: 0.91, source: "latest", stale: true });
  });

  it("throws when no rate is available and currency is not EUR", async () => {
    const lookup = makeLookup([]);
    await expect(resolveFxRate("USD", "2026-04-17", lookup)).rejects.toThrow(
      /no FX rate/,
    );
  });

  it("rejects non-positive explicit rate", async () => {
    const lookup = makeLookup([]);
    await expect(
      resolveFxRate("USD", "2026-04-17", lookup, { explicitRate: 0 }),
    ).rejects.toThrow(/positive/);
  });

  it("accepts a Date and converts to ISO", async () => {
    const lookup = makeLookup([
      { currency: "USD", date: "2026-04-17", rateToEur: 0.92 },
    ]);
    const result = await resolveFxRate(
      "usd",
      new Date(Date.UTC(2026, 3, 17)),
      lookup,
    );
    expect(result.rate).toBe(0.92);
  });
});
