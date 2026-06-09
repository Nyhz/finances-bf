import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../../db/schema";
import type { DB } from "../../../db/client";
import {
  accounts,
  assets,
  assetTransactions,
  assetValuations,
  fxRates,
  priceHistory,
} from "../../../db/schema";
import { recomputeLotsForAsset } from "../lots";
import { buildTaxReport } from "../report";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

/**
 * THE tax invariant, executable (audit R-1): realised gains, losses and
 * dividends must be computed from transaction data alone. Wiping every
 * market-data table (price_history, asset_valuations, fx_rates) must not
 * change a single sale or dividend figure in the report.
 *
 * Year-end balances are the one sanctioned consumer of asset_valuations
 * (Modelo 720 declares market value). Their behaviour without valuations is
 * asserted separately below.
 */
describe("buildTaxReport market independence", () => {
  function seedPortfolio(db: DB) {
    const accountId = ulid();
    const equityId = ulid();
    const cryptoId = ulid();

    db.insert(accounts).values({
      id: accountId, name: "IBKR", currency: "EUR",
      accountType: "broker", countryCode: "US",
      openingBalanceEur: 0, currentCashBalanceEur: 0,
    }).run();
    db.insert(assets).values({
      id: equityId, name: "ACME CORP", assetType: "equity",
      isin: "US0000000001", symbol: "ACME", currency: "USD",
      isActive: true, assetClassTax: "listed_security",
    }).run();
    db.insert(assets).values({
      id: cryptoId, name: "BTC", assetType: "crypto",
      symbol: "BTC", currency: "EUR",
      isActive: true, assetClassTax: "crypto",
    }).run();

    const t = (m: number, d: number) => Date.UTC(2025, m - 1, d);
    const insert = (values: typeof assetTransactions.$inferInsert) =>
      db.insert(assetTransactions).values(values).run();

    // Equity: buy 10, sell 5 at a gain, hold 5 across year-end. EUR amounts
    // are the snapshot stamped at entry time — the report must use these
    // verbatim, never a market quote.
    insert({
      id: ulid(), accountId, assetId: equityId,
      transactionType: "buy", tradedAt: t(1, 10),
      quantity: 10, unitPrice: 108.7, tradeCurrency: "USD", fxRateToEur: 0.92,
      tradeGrossAmount: 1087, tradeGrossAmountEur: 1000.04, cashImpactEur: -1002.04,
      feesAmount: 2.17, feesAmountEur: 2, netAmountEur: -1002.04,
      isListed: true, source: "manual",
    });
    insert({
      id: ulid(), accountId, assetId: equityId,
      transactionType: "sell", tradedAt: t(6, 2),
      quantity: 5, unitPrice: 163.04, tradeCurrency: "USD", fxRateToEur: 0.92,
      tradeGrossAmount: 815.2, tradeGrossAmountEur: 749.98, cashImpactEur: 748.98,
      feesAmount: 1.09, feesAmountEur: 1, netAmountEur: 748.98,
      isListed: true, source: "manual",
    });
    insert({
      id: ulid(), accountId, assetId: equityId,
      transactionType: "dividend", tradedAt: t(3, 17),
      quantity: 0, unitPrice: 0, tradeCurrency: "USD", fxRateToEur: 0.92,
      tradeGrossAmount: 50, tradeGrossAmountEur: 46, cashImpactEur: 39.1,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: 39.1,
      dividendGross: 50, dividendNet: 42.5,
      withholdingTax: 6.9, sourceCountry: "US",
      isListed: true, source: "manual",
    });

    // Crypto: loss sale with a repurchase inside the 60-day window so the
    // wash-sale path (tax_wash_sale_adjustments) is exercised too.
    insert({
      id: ulid(), accountId, assetId: cryptoId,
      transactionType: "buy", tradedAt: t(2, 1),
      quantity: 10, unitPrice: 10, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 100, tradeGrossAmountEur: 100, cashImpactEur: -100,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -100,
      isListed: false, source: "manual",
    });
    insert({
      id: ulid(), accountId, assetId: cryptoId,
      transactionType: "sell", tradedAt: t(3, 1),
      quantity: 10, unitPrice: 5, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 50, tradeGrossAmountEur: 50, cashImpactEur: 50,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: 50,
      isListed: false, source: "manual",
    });
    insert({
      id: ulid(), accountId, assetId: cryptoId,
      transactionType: "buy", tradedAt: t(3, 15),
      quantity: 10, unitPrice: 6, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 60, tradeGrossAmountEur: 60, cashImpactEur: -60,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -60,
      isListed: false, source: "manual",
    });

    db.transaction((tx) => {
      recomputeLotsForAsset(tx as unknown as DB, equityId);
      recomputeLotsForAsset(tx as unknown as DB, cryptoId);
    });

    // Market-data tables populated the way price-sync / backfill would.
    const now = Date.now();
    for (const [symbol, price] of [["ACME", 180], ["BTC", 90000]] as const) {
      db.insert(priceHistory).values({
        id: ulid(), symbol, price,
        pricedAt: Date.UTC(2025, 11, 31), pricedDateUtc: "2025-12-31",
        source: "test", createdAt: now,
      }).run();
    }
    db.insert(fxRates).values({
      id: ulid(), currency: "USD", date: "2025-12-31",
      rateToEur: 0.9, source: "yahoo-fx", createdAt: now,
    }).run();
    db.insert(assetValuations).values({
      id: ulid(), assetId: equityId, valuationDate: "2025-12-31",
      quantity: 5, unitPriceEur: 162, marketValueEur: 810,
      priceSource: "test", createdAt: now,
    }).run();
    db.insert(assetValuations).values({
      id: ulid(), assetId: cryptoId, valuationDate: "2025-12-31",
      quantity: 10, unitPriceEur: 90000, marketValueEur: 900000,
      priceSource: "test", createdAt: now,
    }).run();

    return { accountId, equityId, cryptoId };
  }

  it("sales and dividends are byte-identical after wiping every market table", () => {
    const db = makeDb();
    seedPortfolio(db);

    const before = buildTaxReport(db, 2025);

    // Sanity: the seeded scenario exercises every realised-gain path.
    expect(before.sales).toHaveLength(2);
    expect(before.totals.realizedGainsEur).toBeGreaterThan(0);
    expect(before.totals.nonComputableLossesEur).toBeGreaterThan(0);
    expect(before.dividends).toHaveLength(1);
    // Sanity: valuations were present and used for year-end balances.
    expect(before.yearEndBalances.some((b) => (b.valueEur ?? 0) > 0)).toBe(true);

    db.delete(priceHistory).run();
    db.delete(assetValuations).run();
    db.delete(fxRates).run();

    const after = buildTaxReport(db, 2025);

    expect(after.totals).toStrictEqual(before.totals);
    expect(after.sales).toStrictEqual(before.sales);
    expect(after.dividends).toStrictEqual(before.dividends);
  });

  it("year-end balances without valuations are flagged unvalued, never silent €0", () => {
    // Audit T4: a missing valuation must be visible — €0 would silently
    // suppress the 50k/20k M720 declaration triggers.
    const db = makeDb();
    seedPortfolio(db);

    db.delete(priceHistory).run();
    db.delete(assetValuations).run();
    db.delete(fxRates).run();

    const report = buildTaxReport(db, 2025);
    expect(report.yearEndBalances.length).toBeGreaterThan(0);
    for (const b of report.yearEndBalances) {
      expect(b.valueEur).toBeNull();
      expect(b.unvalued).toBe(true);
      expect(b.quantity).toBeGreaterThan(0); // quantities stay transaction-derived
    }
  });
});
