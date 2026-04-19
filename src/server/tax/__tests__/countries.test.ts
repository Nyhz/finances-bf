import { describe, expect, it } from "vitest";
import { countryFromIsin, ddiTreatyRate } from "../countries";

describe("countryFromIsin", () => {
  it("returns the country code from a US ISIN prefix", () => {
    expect(countryFromIsin("US91324P1021")).toBe("US");
  });
  it("returns the country code from an IE ISIN prefix", () => {
    expect(countryFromIsin("IE00B5L8K969")).toBe("IE");
  });
  it("returns the country code from an ES ISIN prefix", () => {
    expect(countryFromIsin("ES0126962069")).toBe("ES");
  });
  it("returns null for a malformed ISIN", () => {
    expect(countryFromIsin("12ABCDEF1234")).toBeNull();
    expect(countryFromIsin("")).toBeNull();
  });
});

describe("ddiTreatyRate", () => {
  it("returns 0.15 for US (Spain treaty cap)", () => {
    expect(ddiTreatyRate("US")).toBe(0.15);
  });
  it("returns 0 for Spain (no DDI on domestic dividends)", () => {
    expect(ddiTreatyRate("ES")).toBe(0);
  });
  it("returns 0.15 as default for unknown countries", () => {
    expect(ddiTreatyRate("ZZ")).toBe(0.15);
  });
});
