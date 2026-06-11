import { txEur } from "../../money-types";
import { describe, expect, it } from "vitest";
import { buildCasillasCsv } from "../tax-casillas";
import type { TaxReport } from "../../../server/tax/report";

const sample = (overrides?: Partial<TaxReport["totals"]>): TaxReport => ({
  year: 2025,
  sales: [],
  dividends: [],
  yearEndBalances: [],
  totals: {
    realizedGainsEur: txEur(500),
    realizedLossesComputableEur: txEur(-100),
    nonComputableLossesEur: txEur(40),
    netComputableEur: txEur(400),
    proceedsEur: txEur(1500),
    costBasisEur: txEur(1100),
    feesEur: txEur(0),
    dividendsGrossEur: txEur(120),
    withholdingOrigenTotalEur: txEur(18),
    withholdingDestinoTotalEur: txEur(0),
    ...overrides,
  },
});

describe("buildCasillasCsv", () => {
  it("emits one row per casilla with pipe separator and UTF-8 BOM", () => {
    const csv = buildCasillasCsv(sample(), 18);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("0326");
    expect(csv).toContain("0027");
    expect(csv).toContain("0588");
    expect(csv).toContain("0343|");
  });

  it("prints the externally-computed (cuota-capped) DDI verbatim", () => {
    // Audit F3: the CSV used to compute its own UNCAPPED DDI and disagree
    // with the PDF in loss years \u2014 the capped value must flow in.
    const csv = buildCasillasCsv(sample(), 0);
    const ddiLine = csv.split("\n").find((l) => l.startsWith("0588"));
    expect(ddiLine?.endsWith("|0.00")).toBe(true);
  });
});
