import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBinanceCsv } from "./binance";

const fixture = readFileSync(
  join(__dirname, "__fixtures__/binance.csv"),
  "utf8",
);

describe("parseBinanceCsv", () => {
  it("matches the expected ParsedImportRow output", () => {
    const result = parseBinanceCsv(fixture);
    expect(result).toMatchSnapshot();
  });

  it("produces deterministic fingerprints across re-parses", () => {
    const a = parseBinanceCsv(fixture);
    const b = parseBinanceCsv(fixture);
    expect(a.rows.map((r) => r.rowFingerprint)).toEqual(
      b.rows.map((r) => r.rowFingerprint),
    );
  });

  it("splits the pair into base/quote correctly", () => {
    const { rows } = parseBinanceCsv(fixture);
    const trades = rows.filter((r) => r.kind === "trade");
    const btcEur = trades.find(
      (t) => t.assetHint.symbol === "BTC" && t.currency === "EUR",
    );
    expect(btcEur).toBeDefined();
    const ethBtc = trades.find(
      (t) => t.assetHint.symbol === "ETH" && t.currency === "BTC",
    );
    expect(ethBtc).toBeDefined();
  });

  it("emits a separate fee cash_movement when fee coin differs from quote", () => {
    const { rows } = parseBinanceCsv(fixture);
    const feeRows = rows.filter(
      (r) => r.kind === "cash_movement" && r.movement === "fee",
    );
    expect(feeRows).toHaveLength(1);
    expect(feeRows[0].kind).toBe("cash_movement");
    if (feeRows[0].kind === "cash_movement") {
      expect(feeRows[0].currency).toBe("SOL");
      expect(feeRows[0].amountNative).toBeLessThan(0);
    }
  });

  it("reports parse errors for unrecognised pairs", () => {
    const broken = "Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Fee Coin\n2026-01-01 00:00:00,XYZNOTAPAIR,BUY,1,1,1,0,EUR\n";
    const result = parseBinanceCsv(broken);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/Pair/);
  });
});
