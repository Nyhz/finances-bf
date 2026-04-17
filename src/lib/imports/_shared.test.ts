import { describe, expect, it } from "vitest";
import { makeRowFingerprint, parseDecimal, parseCsv } from "./_shared";

describe("makeRowFingerprint", () => {
  it("is deterministic for identical input", () => {
    const a = makeRowFingerprint({
      source: "degiro",
      tradeDate: "2026-01-01",
      assetHint: "NL0010273215",
      side: "buy",
      quantity: 10,
      priceNative: 650.5,
    });
    const b = makeRowFingerprint({
      source: "degiro",
      tradeDate: "2026-01-01",
      assetHint: "NL0010273215",
      side: "buy",
      quantity: 10,
      priceNative: 650.5,
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it("changes when any input field changes", () => {
    const base = {
      source: "degiro" as const,
      tradeDate: "2026-01-01",
      assetHint: "NL0010273215",
      side: "buy",
      quantity: 10,
      priceNative: 650.5,
    };
    expect(makeRowFingerprint(base)).not.toBe(
      makeRowFingerprint({ ...base, side: "sell" }),
    );
    expect(makeRowFingerprint(base)).not.toBe(
      makeRowFingerprint({ ...base, quantity: 11 }),
    );
  });

  it("normalises floating-point noise in number formatting", () => {
    const a = makeRowFingerprint({
      source: "binance",
      tradeDate: "2026-01-01",
      quantity: 0.1 + 0.2,
    });
    const b = makeRowFingerprint({
      source: "binance",
      tradeDate: "2026-01-01",
      quantity: 0.3,
    });
    expect(a).toBe(b);
  });
});

describe("parseDecimal", () => {
  it("parses both decimal separators", () => {
    expect(parseDecimal("1.234,56")).toBeCloseTo(1234.56);
    expect(parseDecimal("1,234.56")).toBeCloseTo(1234.56);
    expect(parseDecimal("1234.56")).toBeCloseTo(1234.56);
    expect(parseDecimal("1234,56")).toBeCloseTo(1234.56);
  });
  it("returns null for empties", () => {
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal(null)).toBeNull();
  });
});

describe("parseCsv", () => {
  it("handles quoted fields with commas", () => {
    const out = parseCsv('a,b,c\n"x,y","quoted ""inner""",z\n');
    expect(out).toEqual([
      ["a", "b", "c"],
      ["x,y", 'quoted "inner"', "z"],
    ]);
  });
  it("strips a UTF-8 BOM", () => {
    const out = parseCsv("\uFEFFa,b\n1,2\n");
    expect(out[0]).toEqual(["a", "b"]);
  });
});
