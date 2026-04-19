import { describe, expect, it } from "vitest";
import { buildCasillasCsv } from "../tax-casillas";
import type { TaxReport } from "../../../server/tax/report";

const sample = (overrides?: Partial<TaxReport["totals"]>): TaxReport => ({
  year: 2025,
  sales: [],
  dividends: [],
  yearEndBalances: [],
  totals: {
    realizedGainsEur: 500,
    realizedLossesComputableEur: -100,
    nonComputableLossesEur: 40,
    netComputableEur: 400,
    proceedsEur: 1500,
    costBasisEur: 1100,
    feesEur: 0,
    dividendsGrossEur: 120,
    withholdingOrigenTotalEur: 18,
    withholdingDestinoTotalEur: 0,
    ...overrides,
  },
});

describe("buildCasillasCsv", () => {
  it("emits one row per casilla with pipe separator and UTF-8 BOM", () => {
    const csv = buildCasillasCsv(sample());
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("0326");
    expect(csv).toContain("0027");
    expect(csv).toContain("0588");
    expect(csv).toContain("0343|");
  });
});
