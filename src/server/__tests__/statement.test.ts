import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { getStatementReport } from "../statement";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedAccount(db: DB, name: string, accountType: string, cashEur = 0): string {
  const id = ulid();
  db.insert(schema.accounts)
    .values({ id, name, accountType, currentCashBalanceEur: cashEur })
    .run();
  return id;
}

function seedAsset(db: DB, name: string, assetType: string): string {
  const id = ulid();
  db.insert(schema.assets).values({ id, name, assetType }).run();
  return id;
}

function seedPosition(db: DB, assetId: string, quantity: number, totalCostEur: number): void {
  db.insert(schema.assetPositions)
    .values({
      id: ulid(),
      assetId,
      quantity,
      averageCost: quantity > 0 ? totalCostEur / quantity : 0,
      averageCostNative: quantity > 0 ? totalCostEur / quantity : 0,
      totalCostNative: totalCostEur,
      totalCostEur,
    })
    .run();
}

function seedValuation(db: DB, assetId: string, quantity: number, unitPriceEur: number): void {
  db.insert(schema.assetValuations)
    .values({
      id: ulid(),
      assetId,
      valuationDate: "2026-06-08",
      quantity,
      unitPriceEur,
      marketValueEur: quantity * unitPriceEur,
      priceSource: "rebuilt",
    })
    .run();
}

function seedBuy(db: DB, accountId: string, assetId: string, grossEur: number): void {
  db.insert(schema.assetTransactions)
    .values({
      id: ulid(),
      accountId,
      assetId,
      transactionType: "buy",
      tradedAt: Date.UTC(2026, 0, 5, 12),
      quantity: 1,
      unitPrice: grossEur,
      tradeCurrency: "EUR",
      fxRateToEur: 1,
      tradeGrossAmount: grossEur,
      tradeGrossAmountEur: grossEur,
      cashImpactEur: -grossEur,
      feesAmount: 0,
      feesAmountEur: 0,
      netAmountEur: -grossEur,
      rowFingerprint: ulid(),
    })
    .run();
}

describe("getStatementReport", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("returns an empty report on a fresh DB", async () => {
    const report = await getStatementReport(db);
    expect(report.totals.netWorthEur).toBe(0);
    expect(report.totals.positionsCount).toBe(0);
    expect(report.groups).toEqual([]);
    expect(report.accounts).toEqual([]);
  });

  it("groups positions by asset type and totals them", async () => {
    const broker = seedAccount(db, "Degiro", "broker");
    const cryptoAcc = seedAccount(db, "Binance", "crypto");
    seedAccount(db, "MyInvestor", "savings", 500);

    const etf = seedAsset(db, "MSCI World", "etf");
    seedPosition(db, etf, 10, 1000);
    seedValuation(db, etf, 10, 120); // market 1200
    seedBuy(db, broker, etf, 1000);

    const coin = seedAsset(db, "Bitcoin", "crypto");
    seedPosition(db, coin, 2, 600);
    seedValuation(db, coin, 2, 250); // market 500
    seedBuy(db, cryptoAcc, coin, 600);

    const report = await getStatementReport(db);

    expect(report.totals.investedMarketValueEur).toBeCloseTo(1700);
    expect(report.totals.investedCostEur).toBeCloseTo(1600);
    expect(report.totals.unrealizedPnlEur).toBeCloseTo(100);
    expect(report.totals.cashEur).toBeCloseTo(500);
    expect(report.totals.netWorthEur).toBeCloseTo(2200);
    expect(report.totals.positionsCount).toBe(2);

    // Biggest group first.
    expect(report.groups.map((g) => g.assetType)).toEqual(["etf", "crypto"]);
    const [etfGroup, cryptoGroup] = report.groups;
    expect(etfGroup.marketValueEur).toBeCloseTo(1200);
    expect(etfGroup.pnlEur).toBeCloseTo(200);
    expect(etfGroup.weight).toBeCloseTo(1200 / 1700);
    expect(cryptoGroup.marketValueEur).toBeCloseTo(500);
    expect(cryptoGroup.pnlEur).toBeCloseTo(-100);

    // Invested value attributed to the account that traded the asset.
    const byName = new Map(report.accounts.map((a) => [a.name, a]));
    expect(byName.get("Degiro")?.investedEur).toBeCloseTo(1200);
    expect(byName.get("Binance")?.investedEur).toBeCloseTo(500);
    expect(byName.get("MyInvestor")?.cashEur).toBeCloseTo(500);
    expect(byName.get("MyInvestor")?.investedEur).toBe(0);
  });

  it("excludes closed positions and handles unvalued assets", async () => {
    const broker = seedAccount(db, "Degiro", "broker");

    const sold = seedAsset(db, "Sold ETF", "etf");
    seedPosition(db, sold, 0, 0);

    const unvalued = seedAsset(db, "Cobas Internacional", "fund");
    seedPosition(db, unvalued, 5, 750);
    seedBuy(db, broker, unvalued, 750);

    const report = await getStatementReport(db);
    expect(report.totals.positionsCount).toBe(1);
    const line = report.groups[0].lines[0];
    expect(line.name).toBe("Cobas Internacional");
    expect(line.marketValueEur).toBeNull();
    expect(line.pnlEur).toBeNull();
    // No valued cost — pct must be null, not divide-by-zero garbage.
    expect(report.totals.unrealizedPnlPct).toBeNull();
    expect(report.totals.investedCostEur).toBeCloseTo(750);
  });
});
