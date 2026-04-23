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

  it("drops Binance fees entirely — no fee-disposal row, no fees on trades", () => {
    const { rows } = parseBinanceCsv(fixture);
    const trades = rows.filter((r) => r.kind === "trade");
    // No synthetic zero-price fee-disposal rows (historically emitted for
    // BNB-paid fees). Binance fees are dust and intentionally ignored.
    const zeroPriceSells = trades.filter(
      (r) => r.kind === "trade" && r.side === "sell" && r.priceNative === 0,
    );
    expect(zeroPriceSells).toHaveLength(0);
    // Every trade has fees stripped to null.
    for (const t of trades) {
      if (t.kind === "trade") expect(t.fees).toBeNull();
    }
  });

  it("emits both legs of a crypto-crypto permuta (ETHBTC BUY → +ETH, -BTC)", () => {
    const csv =
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Fee Coin\n" +
      "2026-03-22 19:30:09,ETHBTC,BUY,0.058,0.5,0.029,0.0001,BTC\n";
    const { rows } = parseBinanceCsv(csv);
    const trades = rows.filter((r) => r.kind === "trade");
    expect(trades).toHaveLength(2);
    const ethLeg = trades.find((t) => t.assetHint.symbol === "ETH");
    const btcLeg = trades.find((t) => t.assetHint.symbol === "BTC");
    expect(ethLeg?.side).toBe("buy");
    expect(ethLeg?.quantity).toBe(0.5);
    expect(ethLeg?.priceNative).toBe(0.058);
    expect(ethLeg?.currency).toBe("BTC");
    expect(btcLeg?.side).toBe("sell");
    expect(btcLeg?.quantity).toBe(0.029);
    expect(btcLeg?.priceNative).toBe(1);
    expect(btcLeg?.currency).toBe("BTC");
    expect(ethLeg?.rowFingerprint).not.toBe(btcLeg?.rowFingerprint);
  });

  it("emits both legs for a stablecoin-quoted trade (SOLUSDT BUY → +SOL, -USDT)", () => {
    const csv =
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Fee Coin\n" +
      "2026-02-18 21:03:44,SOLUSDT,BUY,95.40,10,954,0.01,SOL\n";
    const { rows } = parseBinanceCsv(csv);
    const trades = rows.filter((r) => r.kind === "trade");
    expect(trades).toHaveLength(2);
    const sol = trades.find((t) => t.assetHint.symbol === "SOL");
    const usdt = trades.find((t) => t.assetHint.symbol === "USDT");
    expect(sol?.side).toBe("buy");
    expect(usdt?.side).toBe("sell");
    expect(usdt?.quantity).toBe(954);
  });

  it("does NOT emit a second leg for fiat-quoted trades", () => {
    const csv =
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Fee Coin\n" +
      "2026-01-15 10:21:33,BTCEUR,BUY,42000,0.05,2100,2.10,EUR\n";
    const { rows } = parseBinanceCsv(csv);
    const trades = rows.filter((r) => r.kind === "trade");
    expect(trades).toHaveLength(1);
    expect(trades[0].assetHint.symbol).toBe("BTC");
    expect(trades[0].currency).toBe("EUR");
  });

  it("reports parse errors for unrecognised pairs", () => {
    const broken = "Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Fee Coin\n2026-01-01 00:00:00,XYZNOTAPAIR,BUY,1,1,1,0,EUR\n";
    const result = parseBinanceCsv(broken);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/Pair/);
  });
});
