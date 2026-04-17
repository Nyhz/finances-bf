import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDegiroCsv } from "./degiro";

const fixture = readFileSync(
  join(__dirname, "__fixtures__/degiro.csv"),
  "utf8",
);

describe("parseDegiroCsv", () => {
  it("matches the expected ParsedImportRow output", () => {
    const result = parseDegiroCsv(fixture);
    expect(result).toMatchSnapshot();
  });

  it("produces deterministic fingerprints across re-parses", () => {
    const a = parseDegiroCsv(fixture);
    const b = parseDegiroCsv(fixture);
    expect(a.rows.map((r) => r.rowFingerprint)).toEqual(
      b.rows.map((r) => r.rowFingerprint),
    );
  });

  it("derives buy/sell from the quantity sign", () => {
    const { rows } = parseDegiroCsv(fixture);
    const trades = rows.filter((r) => r.kind === "trade");
    expect(trades.find((t) => t.assetHint.isin === "NL0010273215")?.side).toBe(
      "buy",
    );
    const apple = trades.filter((t) => t.assetHint.isin === "US0378331005");
    expect(apple.map((t) => t.side)).toEqual(["buy", "sell"]);
  });

  it("classifies cash movements by product description", () => {
    const { rows } = parseDegiroCsv(fixture);
    const cash = rows.filter((r) => r.kind === "cash_movement");
    const movements = cash.map((r) => r.movement).sort();
    expect(movements).toEqual(["deposit", "dividend", "fee", "withdrawal"]);
  });

  it("reports parse errors instead of throwing on malformed rows", () => {
    const broken = "Date,Time,Product,ISIN,Quantity,Price,Total\n,,Foo,,1,,\n";
    const result = parseDegiroCsv(broken);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/Date/);
  });
});
