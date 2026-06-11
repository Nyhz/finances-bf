import { describe, expect, it } from "vitest";
import { computeXirr } from "../xirr";

describe("computeXirr", () => {
  it("recovers a simple annual rate", () => {
    const rate = computeXirr([
      { dateIso: "2024-01-01", amountEur: -1000 },
      { dateIso: "2025-01-01", amountEur: 1100 },
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0.1, 3);
  });

  it("weights a mid-period contribution by its time invested", () => {
    // 1000 € a year, plus 1000 € the last six months; payoff 2200 €.
    // The second 1000 € was invested half the time, so the annual rate
    // must exceed the naive 10 % of (2200 / 2000 - 1).
    const rate = computeXirr([
      { dateIso: "2024-01-01", amountEur: -1000 },
      { dateIso: "2024-07-01", amountEur: -1000 },
      { dateIso: "2025-01-01", amountEur: 2200 },
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(0.1);
    expect(rate!).toBeLessThan(0.2);
  });

  it("handles negative returns", () => {
    const rate = computeXirr([
      { dateIso: "2024-01-01", amountEur: -1000 },
      { dateIso: "2025-01-01", amountEur: 850 },
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(-0.15, 3);
  });

  it("returns null for too-short spans (annualising noise)", () => {
    expect(
      computeXirr([
        { dateIso: "2024-01-01", amountEur: -1000 },
        { dateIso: "2024-01-10", amountEur: 1050 },
      ]),
    ).toBeNull();
  });

  it("returns null without both signs", () => {
    expect(
      computeXirr([
        { dateIso: "2024-01-01", amountEur: -1000 },
        { dateIso: "2025-01-01", amountEur: -500 },
      ]),
    ).toBeNull();
  });
});
