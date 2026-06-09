import { describe, expect, it } from "vitest";
import {
  applySavingsScale,
  estimateSavingsCuota,
  savingsScaleForYear,
  type CuotaEstimateInput,
} from "../cuota";

function input(partial: {
  year?: number;
  netComputableEur?: number;
  dividendsGrossEur?: number;
  withholdingDestinoTotalEur?: number;
  dividends?: CuotaEstimateInput["dividends"];
}): CuotaEstimateInput {
  return {
    year: partial.year ?? 2025,
    dividends: partial.dividends ?? [],
    totals: {
      netComputableEur: partial.netComputableEur ?? 0,
      dividendsGrossEur: partial.dividendsGrossEur ?? 0,
      withholdingDestinoTotalEur: partial.withholdingDestinoTotalEur ?? 0,
    },
  };
}

describe("savingsScaleForYear", () => {
  it("uses the 20%–25% scale through 2025", () => {
    expect(savingsScaleForYear(2025).brackets[0].rate).toBe(0.2);
    expect(savingsScaleForYear(2014).brackets.at(-1)?.rate).toBe(0.25);
  });
  it("uses the 19%–28% scale from 2026", () => {
    expect(savingsScaleForYear(2026).brackets[0].rate).toBe(0.19);
    expect(savingsScaleForYear(2030).brackets.at(-1)?.rate).toBe(0.28);
  });
});

describe("applySavingsScale", () => {
  it("returns 0 for zero or negative base", () => {
    const scale = savingsScaleForYear(2025);
    expect(applySavingsScale(0, scale)).toBe(0);
    expect(applySavingsScale(-1000, scale)).toBe(0);
  });
  it("applies the 2025 scale marginally", () => {
    const scale = savingsScaleForYear(2025);
    // 2500×20% = 500
    expect(applySavingsScale(2_500, scale)).toBe(500);
    // 500 + 7500×21% + 5000×22% + 15000×23% = 500+1575+1100+3450 = 6625
    expect(applySavingsScale(30_000, scale)).toBe(6_625);
    // 6625 + 10000×25% = 9125
    expect(applySavingsScale(40_000, scale)).toBe(9_125);
  });
  it("matches the published cumulative quotas of the 2026 scale", () => {
    const scale = savingsScaleForYear(2026);
    // Cuotas íntegras publicadas por la DFB para la tarifa 2026.
    expect(applySavingsScale(7_500, scale)).toBe(1_425);
    expect(applySavingsScale(15_000, scale)).toBe(2_925);
    expect(applySavingsScale(30_000, scale)).toBe(6_225);
    expect(applySavingsScale(50_000, scale)).toBe(11_025);
    expect(applySavingsScale(90_000, scale)).toBe(21_225);
    expect(applySavingsScale(120_000, scale)).toBe(29_025);
    expect(applySavingsScale(240_000, scale)).toBe(60_825);
    expect(applySavingsScale(300_000, scale)).toBe(77_025);
    expect(applySavingsScale(400_000, scale)).toBe(77_025 + 100_000 * 0.28);
  });
});

describe("estimateSavingsCuota", () => {
  it("adds gains and RCM when both are positive", () => {
    const est = estimateSavingsCuota(
      input({ netComputableEur: 10_000, dividendsGrossEur: 2_000 }),
      500,
    );
    expect(est.saldoRcmEur).toBe(2_500);
    expect(est.baseAhorroEur).toBe(12_500);
    expect(est.lossOffsetAppliedEur).toBe(0);
    expect(est.lossCarryForwardEur).toBe(0);
    // 2025 scale: 500 + 1575 + 2500×22% = 2625
    expect(est.cuotaIntegraEur).toBe(2_625);
  });

  it("caps loss offset against RCM at 25% and carries the rest forward", () => {
    const est = estimateSavingsCuota(
      input({ netComputableEur: -5_000, dividendsGrossEur: 4_000 }),
    );
    expect(est.lossOffsetAppliedEur).toBe(1_000); // 25% of 4000
    expect(est.lossCarryForwardEur).toBe(4_000);
    expect(est.baseAhorroEur).toBe(3_000);
  });

  it("carries the full loss forward when there is no RCM", () => {
    const est = estimateSavingsCuota(input({ netComputableEur: -3_000 }));
    expect(est.baseAhorroEur).toBe(0);
    expect(est.cuotaIntegraEur).toBe(0);
    expect(est.lossCarryForwardEur).toBe(3_000);
    expect(est.resultadoEstimadoEur).toBe(0);
  });

  it("credits DDI per dividend capped at the treaty rate and at the cuota", () => {
    const est = estimateSavingsCuota(
      input({
        netComputableEur: 0,
        dividendsGrossEur: 1_000,
        dividends: [
          // US: 30% withheld but treaty caps the credit at 15%
          { grossEur: 1_000, withholdingOrigenEur: 300, sourceCountry: "US" },
        ],
      }),
    );
    expect(est.ddiCreditEur).toBe(150);
    // cuota íntegra 1000×20% = 200; resultado = 200 − 150
    expect(est.resultadoEstimadoEur).toBe(50);
  });

  it("subtracts destination withholding as payment on account (can go negative)", () => {
    const est = estimateSavingsCuota(
      input({
        netComputableEur: 0,
        dividendsGrossEur: 1_000,
        withholdingDestinoTotalEur: 250,
        dividends: [{ grossEur: 1_000, withholdingOrigenEur: 0, sourceCountry: "ES" }],
      }),
    );
    expect(est.cuotaIntegraEur).toBe(200);
    expect(est.resultadoEstimadoEur).toBe(-50);
  });
});
