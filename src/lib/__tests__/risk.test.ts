import { describe, expect, it } from "vitest";
import { computeRiskMetrics, drawdownSeries } from "../risk";

const day = (i: number) => `2026-01-${String(i + 1).padStart(2, "0")}`;

describe("drawdownSeries", () => {
  it("is zero at new highs and negative below the running peak", () => {
    const dd = drawdownSeries(
      [100, 110, 99, 121].map((index, i) => ({ date: day(i), index })),
    );
    expect(dd.map((p) => p.drawdown)).toEqual([0, 0, 99 / 110 - 1, 0]);
  });
});

describe("computeRiskMetrics", () => {
  it("finds the deepest fall and the worst day", () => {
    const metrics = computeRiskMetrics(
      [100, 110, 99, 121, 115].map((index, i) => ({ date: day(i), index })),
    );
    expect(metrics).not.toBeNull();
    expect(metrics!.maxDrawdown).toBeCloseTo(99 / 110 - 1, 10);
    expect(metrics!.maxDrawdownDate).toBe(day(2));
    expect(metrics!.worstDay?.date).toBe(day(2));
    expect(metrics!.worstDay?.dailyReturn).toBeCloseTo(99 / 110 - 1, 10);
    expect(metrics!.bestDay?.date).toBe(day(3));
    // Four observations: too few for an honest volatility.
    expect(metrics!.annualizedVolatility).toBeNull();
  });

  it("annualises volatility with enough observations", () => {
    const points = Array.from({ length: 30 }, (_, i) => ({
      date: day(i),
      index: 100 * (1 + (i % 2 === 0 ? 0.01 : -0.01)) ** i,
    }));
    const metrics = computeRiskMetrics(points);
    expect(metrics?.annualizedVolatility).not.toBeNull();
    expect(metrics!.annualizedVolatility!).toBeGreaterThan(0);
  });
});
