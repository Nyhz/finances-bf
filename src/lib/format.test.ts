import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatEur,
  formatMoney,
  formatPercent,
} from "./format";

const nbsp = /\s/g;
const strip = (s: string) => s.replace(nbsp, " ");

describe("formatEur", () => {
  it("formats zero", () => {
    expect(strip(formatEur(0))).toBe("€0.00");
  });

  it("formats negatives", () => {
    expect(strip(formatEur(-12.5))).toBe("-€12.50");
  });

  it("formats very large values with grouping", () => {
    expect(strip(formatEur(1234567890.12))).toBe("€1,234,567,890.12");
  });

  it("rounds fractional cents to two decimals", () => {
    expect(strip(formatEur(1.005))).toBe("€1.01");
    expect(strip(formatEur(1.004))).toBe("€1.00");
  });
});

describe("formatMoney", () => {
  it("delegates EUR through the standard formatter", () => {
    expect(strip(formatMoney(10, "EUR"))).toBe(strip(formatEur(10)));
  });

  it("formats USD with its symbol", () => {
    expect(strip(formatMoney(12.34, "USD"))).toContain("12.34");
  });

  it("requires a currency", () => {
    expect(() => formatMoney(1, "")).toThrow();
  });
});

describe("formatPercent", () => {
  it("formats a ratio as percentage", () => {
    expect(strip(formatPercent(0))).toBe("0.00%");
    expect(strip(formatPercent(0.1234))).toBe("12.34%");
    expect(strip(formatPercent(-0.05))).toBe("-5.00%");
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
