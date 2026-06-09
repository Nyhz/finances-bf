import { marketEur } from "../../../lib/money-types";
import { describe, expect, it } from "vitest";
import { aggregateBlocksFromBalances } from "../m720Aggregate";
import type { YearEndBalance } from "../report";

describe("aggregateBlocksFromBalances", () => {
  it("aggregates securities per account country and asset class", () => {
    const balances: YearEndBalance[] = [
      { accountId: "a", accountName: "DEGIRO", accountCountry: "NL", accountType: "broker", assetId: "x", assetName: "UNH", isin: "US91324P1021", assetClassTax: "listed_security", quantity: 3, valueEur: marketEur(900), valuationDate: "2025-12-31", priceSource: "test", unvalued: false, staleValuation: false },
      { accountId: "a", accountName: "DEGIRO", accountCountry: "NL", accountType: "broker", assetId: "y", assetName: "VWCE", isin: "IE00BK5BQT80", assetClassTax: "etf", quantity: 200, valueEur: marketEur(25_000), valuationDate: "2025-12-31", priceSource: "test", unvalued: false, staleValuation: false },
      { accountId: "b", accountName: "BINANCE", accountCountry: "MT", accountType: "crypto_exchange", assetId: "z", assetName: "BTC", isin: null, assetClassTax: "crypto", quantity: 1, valueEur: marketEur(60_000), valuationDate: "2025-12-31", priceSource: "test", unvalued: false, staleValuation: false },
    ];
    const blocks = aggregateBlocksFromBalances(balances);
    const nl = blocks.find((b) => b.country === "NL" && b.type === "broker-securities");
    expect(nl?.valueEur).toBeCloseTo(25_900, 2);
    const mt = blocks.find((b) => b.country === "MT" && b.type === "crypto");
    expect(mt?.valueEur).toBeCloseTo(60_000, 2);
  });

  it("skips balances with no country", () => {
    const blocks = aggregateBlocksFromBalances([
      { accountId: "a", accountName: "X", accountCountry: null, accountType: "broker", assetId: "y", assetName: "VWCE", isin: "IE00BK5BQT80", assetClassTax: "etf", quantity: 1, valueEur: marketEur(100), valuationDate: "2025-12-31", priceSource: "test", unvalued: false, staleValuation: false },
    ]);
    expect(blocks).toHaveLength(0);
  });
});
