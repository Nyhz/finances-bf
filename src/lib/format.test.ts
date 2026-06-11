import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatEur,
  formatEurCompact,
  formatMoney,
  formatPercent,
  formatQuantity,
} from "./format";

// es-ES emite espacios no separables (U+00A0 / U+202F) antes de «€» y «%»;
// se normalizan a espacio simple para que las aserciones sean legibles.
const nbsp = /\s/g;
const strip = (s: string) => s.replace(nbsp, " ");

describe("formatEur", () => {
  it("formats zero", () => {
    expect(strip(formatEur(0))).toBe("0,00 €");
  });

  it("formats negatives", () => {
    expect(strip(formatEur(-12.5))).toBe("-12,50 €");
  });

  it("formats very large values with grouping", () => {
    expect(strip(formatEur(1234567890.12))).toBe("1.234.567.890,12 €");
  });

  it("rounds fractional cents to two decimals", () => {
    expect(strip(formatEur(1.005))).toBe("1,01 €");
    expect(strip(formatEur(1.004))).toBe("1,00 €");
  });

  it("honours a wider maximumFractionDigits for unit prices", () => {
    expect(strip(formatEur(1.2345, { maximumFractionDigits: 4 }))).toBe("1,2345 €");
    expect(strip(formatEur(1.2, { maximumFractionDigits: 4 }))).toBe("1,20 €");
  });
});

describe("formatEurCompact", () => {
  it("renders thousands as k€ with one decimal", () => {
    expect(strip(formatEurCompact(12300))).toBe("12,3 k€");
    expect(strip(formatEurCompact(-12300))).toBe("-12,3 k€");
  });

  it("renders sub-thousand values without decimals", () => {
    expect(strip(formatEurCompact(950))).toBe("950 €");
    expect(strip(formatEurCompact(0))).toBe("0 €");
  });
});

describe("formatQuantity", () => {
  it("formats with es-ES separators and 4 decimals by default", () => {
    // es-ES omite el separador de millar en números de 4 dígitos (CLDR).
    expect(formatQuantity(1234.56789)).toBe("1234,5679");
    expect(formatQuantity(1234567.89)).toBe("1.234.567,89");
    expect(formatQuantity(10)).toBe("10");
  });

  it("honours maximumFractionDigits", () => {
    expect(formatQuantity(0.12345678, { maximumFractionDigits: 8 })).toBe(
      "0,12345678",
    );
  });
});

describe("formatMoney", () => {
  it("delegates EUR through the standard formatter", () => {
    expect(strip(formatMoney(10, "EUR"))).toBe(strip(formatEur(10)));
  });

  it("formats USD with its symbol", () => {
    expect(strip(formatMoney(12.34, "USD"))).toContain("12,34");
  });

  it("requires a currency", () => {
    expect(() => formatMoney(1, "")).toThrow();
  });
});

describe("formatPercent", () => {
  it("formats a ratio as percentage", () => {
    expect(strip(formatPercent(0))).toBe("0,00 %");
    expect(strip(formatPercent(0.1234))).toBe("12,34 %");
    expect(strip(formatPercent(-0.05))).toBe("-5,00 %");
  });
});

describe("formatDate / formatDateTime", () => {
  it("formats dates as ISO yyyy-MM-dd", () => {
    expect(formatDate(new Date("2026-04-17T09:30:00Z"))).toMatch(/^2026-04-\d{2}$/);
  });

  it("formats datetimes with minutes", () => {
    expect(formatDateTime(new Date("2026-04-17T09:30:00Z"))).toMatch(
      /^2026-04-\d{2} \d{2}:\d{2}$/,
    );
  });
});
