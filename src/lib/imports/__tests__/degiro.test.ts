import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDegiroCsv } from "../degiro";

const FIXTURE = readFileSync(
  join(__dirname, "../__fixtures__/degiro.sample.csv"),
  "utf8",
);

describe("parseDegiroCsv", () => {
  const result = parseDegiroCsv(FIXTURE);

  it("produces no parse errors", () => {
    expect(result.errors).toHaveLength(0);
  });

  it("extracts every trade with correct qty, price, currency, ISIN", () => {
    const buys = result.rows.filter((r) => r.kind === "trade" && r.side === "buy");
    expect(buys.length).toBeGreaterThanOrEqual(8);
    const unitedHealth = buys.find((b) => b.kind === "trade" && b.assetHint.isin === "US91324P1021");
    expect(unitedHealth).toBeDefined();
    if (unitedHealth && unitedHealth.kind === "trade") {
      expect(unitedHealth.quantity).toBe(3);
      expect(unitedHealth.priceNative).toBeCloseTo(309.98, 4);
      expect(unitedHealth.currency).toBe("USD");
      expect(unitedHealth.fxRateToEurOverride).toBeGreaterThan(0);
      expect(unitedHealth.fxRateToEurOverride).toBeLessThan(1);
    }
  });

  it("folds transaction fees into trade rows (EUR, already EUR)", () => {
    const vanguard = result.rows.find(
      (r) => r.kind === "trade" && r.assetHint.isin === "IE00BK5BQT80" && r.quantity === 115,
    );
    expect(vanguard).toBeDefined();
    if (vanguard && vanguard.kind === "trade") {
      expect(vanguard.fees).toBeCloseTo(1.0, 2);
      expect(vanguard.feesAlreadyEur).toBe(true);
    }
  });

  it("extracts dividends paired with retención origen and FX rate", () => {
    const dividends = result.rows.filter((r) => r.kind === "dividend");
    expect(dividends.length).toBeGreaterThanOrEqual(3);
    const first = dividends[0];
    if (first.kind === "dividend") {
      expect(first.assetHint.isin).toBe("US91324P1021");
      expect(first.grossNative).toBeCloseTo(6.63, 2);
      expect(first.currency).toBe("USD");
      expect(first.withholdingOrigenNative).toBeCloseTo(0.99, 2);
      expect(first.sourceCountry).toBe("US");
      expect(first.fxRateToEurOverride).toBeGreaterThan(0);
      expect(first.fxRateToEurOverride).toBeLessThan(1);
    }
  });

  it("ignores cash sweeps, deposits, interest, connectivity fees, ADR fees, bare Ingreso", () => {
    // Anything that isn't a trade or a dividend must not appear.
    const nonTradeNonDiv = result.rows.filter(
      (r) => r.kind !== "trade" && r.kind !== "dividend",
    );
    expect(nonTradeNonDiv).toHaveLength(0);
  });

  it("produces stable rowFingerprint for dedup", () => {
    const rerun = parseDegiroCsv(FIXTURE);
    const a = result.rows.map((r) => r.rowFingerprint).sort();
    const b = rerun.rows.map((r) => r.rowFingerprint).sort();
    expect(b).toEqual(a);
  });
});
