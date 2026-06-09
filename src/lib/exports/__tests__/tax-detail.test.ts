import { txEur } from "../../money-types";
import { describe, expect, it } from "vitest";
import { buildDetailCsv } from "../tax-detail";
import type { TaxReport } from "../../../server/tax/report";

const report: TaxReport = {
  year: 2025,
  sales: [
    {
      transactionId: "tx1", valuationBasis: null, tradedAt: Date.UTC(2025, 5, 1),
      accountId: "a", assetId: "x",
      quantity: 10, proceedsEur: txEur(1500), feesEur: txEur(0), costBasisEur: txEur(1000),
      rawGainLossEur: txEur(500), nonComputableLossEur: txEur(0), computableGainLossEur: txEur(500),
      consumedLots: [{ lotId: "l1", acquiredAt: Date.UTC(2025, 0, 1), qtyConsumed: 10, costBasisEur: txEur(1000) }],
      assetName: "UNH", isin: "US91324P1021", assetClassTax: "listed_security",
    },
  ],
  dividends: [
    {
      transactionId: "d1", tradedAt: Date.UTC(2025, 2, 17),
      accountId: "a", assetId: "x",
      assetName: "UNH", isin: "US91324P1021",
      sourceCountry: "US",
      grossNative: 6.63, grossEur: txEur(6.10),
      withholdingOrigenEur: txEur(0.91), withholdingDestinoEur: txEur(0),
      netEur: txEur(5.19),
    },
  ],
  yearEndBalances: [],
  totals: {
    realizedGainsEur: txEur(500), realizedLossesComputableEur: txEur(0), nonComputableLossesEur: txEur(0),
    netComputableEur: txEur(500), proceedsEur: txEur(1500), costBasisEur: txEur(1000), feesEur: txEur(0),
    dividendsGrossEur: txEur(6.10), withholdingOrigenTotalEur: txEur(0.91), withholdingDestinoTotalEur: txEur(0),
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
