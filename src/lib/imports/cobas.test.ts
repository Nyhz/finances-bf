import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCobasCsv } from "./cobas";

const fixture = readFileSync(
  join(__dirname, "__fixtures__/cobas.csv"),
  "utf8",
);

describe("parseCobasCsv", () => {
  it("matches the expected ParsedImportRow output", () => {
    const result = parseCobasCsv(fixture);
    expect(result).toMatchSnapshot();
  });

  it("produces deterministic fingerprints across re-parses", () => {
    const a = parseCobasCsv(fixture);
    const b = parseCobasCsv(fixture);
    expect(a.rows.map((r) => r.rowFingerprint)).toEqual(
      b.rows.map((r) => r.rowFingerprint),
    );
  });

  it("maps Suscripción to buy and Reembolso to sell", () => {
    const { rows } = parseCobasCsv(fixture);
    const trades = rows.filter((r) => r.kind === "trade");
    expect(trades.map((t) => t.side)).toEqual(["buy", "buy", "sell"]);
  });

  it("maps management fees and dividends to cash movements", () => {
    const { rows } = parseCobasCsv(fixture);
    const cash = rows.filter((r) => r.kind === "cash_movement");
    const movements = cash.map((r) => r.movement).sort();
    expect(movements).toEqual(["dividend", "fee", "fee"]);
  });

  it("reports parse errors for unknown operations", () => {
    const broken =
      "Fecha,Operación,Fondo,ISIN,Participaciones,Valor liquidativo,Importe,Divisa\n2026-01-01,Mystery,Foo,ES000,,,1,EUR\n";
    const result = parseCobasCsv(broken);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/Operación/);
  });
});
