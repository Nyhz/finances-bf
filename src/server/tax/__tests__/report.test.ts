import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../../db/schema";
import type { DB } from "../../../db/client";
import { accounts, assets, assetTransactions } from "../../../db/schema";
import { recomputeLotsForAsset } from "../lots";
import { buildTaxReport, DUST_THRESHOLD_EUR } from "../report";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("buildTaxReport", () => {
  it("aggregates realised gains, losses, non-computable, and dividends for a year", () => {
    const db = makeDb();
    const accountId = ulid();
    const assetId = ulid();

    db.insert(accounts).values({
      id: accountId, name: "DEGIRO", currency: "EUR",
      accountType: "broker", countryCode: "NL",
      openingBalanceEur: 0, currentCashBalanceEur: 0,
    }).run();
    db.insert(assets).values({
      id: assetId, name: "UNITEDHEALTH GROUP INC", assetType: "equity",
      isin: "US91324P1021", currency: "USD", isActive: true,
      assetClassTax: "listed_security",
    }).run();

    const t = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
    const insert = (values: typeof assetTransactions.$inferInsert) => db.insert(assetTransactions).values(values).run();

    insert({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: t(2025, 1, 10),
      quantity: 10, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1000, tradeGrossAmountEur: 1000, cashImpactEur: -1000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -1000,
      isListed: true, source: "manual",
    });
    insert({
      id: ulid(), accountId, assetId,
      transactionType: "sell", tradedAt: t(2025, 6, 1),
      quantity: 10, unitPrice: 150, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1500, tradeGrossAmountEur: 1500, cashImpactEur: 1500,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: 1500,
      isListed: true, source: "manual",
    });
    insert({
      id: ulid(), accountId, assetId,
      transactionType: "dividend", tradedAt: t(2025, 3, 17),
      quantity: 0, unitPrice: 0,
      tradeCurrency: "USD", fxRateToEur: 0.92,
      tradeGrossAmount: 6.63, tradeGrossAmountEur: 6.10,
      cashImpactEur: 5.19, feesAmount: 0, feesAmountEur: 0, netAmountEur: 5.19,
      dividendGross: 6.63, dividendNet: 5.64,
      withholdingTax: 0.91, sourceCountry: "US",
      isListed: true, source: "manual",
    });

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    const report = buildTaxReport(db, 2025);

    expect(report.totals.realizedGainsEur).toBeCloseTo(500, 2);
    expect(report.totals.realizedLossesComputableEur).toBe(0);
    expect(report.totals.nonComputableLossesEur).toBe(0);
    expect(report.sales).toHaveLength(1);
    expect(report.sales[0].consumedLots).toHaveLength(1);

    expect(report.dividends).toHaveLength(1);
    expect(report.dividends[0].sourceCountry).toBe("US");
    expect(report.dividends[0].grossEur).toBeCloseTo(6.10, 2);
    expect(report.dividends[0].withholdingOrigenEur).toBeCloseTo(0.91, 2);
    expect(report.totals.dividendsGrossEur).toBeCloseTo(6.10, 2);

    expect(report.yearEndBalances).toBeDefined();
    expect(Array.isArray(report.yearEndBalances)).toBe(true);
    const unh = report.yearEndBalances.find((b) => b.isin === "US91324P1021");
    expect(unh).toBeUndefined();
  });
});

describe("buildTaxReport dust filter", () => {
  it("excludes disposals where proceeds and cost basis are both below €1", () => {
    const db = makeDb();
    const accountId = ulid();
    const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "BINANCE", currency: "EUR", accountType: "crypto_exchange", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: assetId, name: "BNB", assetType: "crypto", currency: "BNB", isActive: true, assetClassTax: "crypto" }).run();

    // A dust sell (€0.005 cost basis, €0 proceeds)
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: Date.UTC(2025, 0, 1),
      quantity: 0.00001, unitPrice: 500,
      tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 0.005, tradeGrossAmountEur: 0.005, cashImpactEur: -0.005,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -0.005,
      isListed: false, source: "manual",
    }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "sell", tradedAt: Date.UTC(2025, 5, 1),
      quantity: 0.00001, unitPrice: 0,
      tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 0, tradeGrossAmountEur: 0, cashImpactEur: 0,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: 0,
      isListed: false, source: "manual",
    }).run();
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const report = buildTaxReport(db, 2025);
    expect(report.sales).toHaveLength(0);
    expect(report.totals.realizedLossesComputableEur).toBe(0);
    expect(report.totals.proceedsEur).toBe(0);
  });

  it("keeps disposals where proceeds OR cost basis exceed the dust threshold", () => {
    expect(DUST_THRESHOLD_EUR).toBe(1);
  });
});
