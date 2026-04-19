import { describe, expect, it } from "vitest";
import { buildDetailCsv } from "../tax-detail";
import type { TaxReport } from "../../../server/tax/report";

const report: TaxReport = {
  year: 2025,
  sales: [
    {
      transactionId: "tx1", tradedAt: Date.UTC(2025, 5, 1),
      accountId: "a", assetId: "x",
      quantity: 10, proceedsEur: 1500, feesEur: 0, costBasisEur: 1000,
      rawGainLossEur: 500, nonComputableLossEur: 0, computableGainLossEur: 500,
      consumedLots: [{ lotId: "l1", acquiredAt: Date.UTC(2025, 0, 1), qtyConsumed: 10, costBasisEur: 1000 }],
      assetName: "UNH", isin: "US91324P1021", assetClassTax: "listed_security",
    },
  ],
  dividends: [
    {
      transactionId: "d1", tradedAt: Date.UTC(2025, 2, 17),
      accountId: "a", assetId: "x",
      assetName: "UNH", isin: "US91324P1021",
      sourceCountry: "US",
      grossNative: 6.63, grossEur: 6.10,
      withholdingOrigenEur: 0.91, withholdingDestinoEur: 0,
      netEur: 5.19,
    },
  ],
  yearEndBalances: [],
  totals: {
    realizedGainsEur: 500, realizedLossesComputableEur: 0, nonComputableLossesEur: 0,
    netComputableEur: 500, proceedsEur: 1500, costBasisEur: 1000, feesEur: 0,
    dividendsGrossEur: 6.10, withholdingOrigenTotalEur: 0.91, withholdingDestinoTotalEur: 0,
  },
};

describe("buildDetailCsv", () => {
  it("includes sales, lots, dividends blocks", () => {
    const csv = buildDetailCsv(report);
    expect(csv).toContain("# SALES");
    expect(csv).toContain("tx1");
    expect(csv).toContain("US91324P1021");
    expect(csv).toContain("# DIVIDENDS");
    expect(csv).toContain("d1");
    expect(csv).toContain("# LOTS CONSUMED");
    expect(csv).toContain("l1");
  });
});
