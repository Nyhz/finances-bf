import { describe, expect, it } from "vitest";
import { inferAssetClassTax } from "../classification";

describe("inferAssetClassTax", () => {
  it("classifies ETFs by ticker hint", () => {
    expect(inferAssetClassTax({ assetType: "equity", ticker: "VWCE", isin: "IE00BK5BQT80" })).toBe("etf");
  });
  it("classifies Irish-domiciled funds as etf when name contains UCITS", () => {
    expect(inferAssetClassTax({ assetType: "equity", name: "iShares MSCI Whatever UCITS ETF", isin: "IE00B5L8K969" })).toBe("etf");
  });
  it("classifies crypto assets", () => {
    expect(inferAssetClassTax({ assetType: "crypto" })).toBe("crypto");
  });
  it("defaults ES-listed equities to listed_security", () => {
    expect(inferAssetClassTax({ assetType: "equity", isin: "ES0126962069" })).toBe("listed_security");
  });
  it("defaults US equities to listed_security", () => {
    expect(inferAssetClassTax({ assetType: "equity", isin: "US91324P1021" })).toBe("listed_security");
  });
  it("returns other when nothing matches", () => {
    expect(inferAssetClassTax({ assetType: "unknown" })).toBe("other");
  });
});
