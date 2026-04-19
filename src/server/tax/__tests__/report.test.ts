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
import { buildTaxReport } from "../report";

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
  });
});
