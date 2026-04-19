import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../../db/schema";
import type { DB } from "../../../db/client";
import { accounts, assets, assetTransactions } from "../../../db/schema";
import { recomputeLotsForAsset } from "../lots";
import { computeDriftSinceSeal, getSnapshot } from "../seals";
import { sealYear } from "../../../actions/sealYear";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seed(db: DB) {
  const accountId = ulid(); const assetId = ulid();
  db.insert(accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
  db.insert(assets).values({ id: assetId, name: "X", assetType: "equity", currency: "EUR", isActive: true, assetClassTax: "etf" }).run();
  db.insert(assetTransactions).values({
    id: ulid(), accountId, assetId,
    transactionType: "buy", tradedAt: Date.UTC(2025, 0, 1),
    quantity: 10, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
    tradeGrossAmount: 1000, tradeGrossAmountEur: 1000, cashImpactEur: -1000,
    feesAmount: 0, feesAmountEur: 0, netAmountEur: -1000,
    isListed: true, source: "manual",
  }).run();
  db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
  return { accountId, assetId };
}

describe("computeDriftSinceSeal", () => {
  it("returns null when no snapshot exists", () => {
    const db = makeDb();
    expect(computeDriftSinceSeal(db, 2025)).toBeNull();
  });

  it("returns null when sealed report matches live report", async () => {
    const db = makeDb();
    seed(db);
    await sealYear({ year: 2025 }, db);
    expect(computeDriftSinceSeal(db, 2025)).toBeNull();
  });

  it("returns a drift report when post-seal edits change totals", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    await sealYear({ year: 2025 }, db);

    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "sell", tradedAt: Date.UTC(2025, 5, 1),
      quantity: 10, unitPrice: 150, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1500, tradeGrossAmountEur: 1500, cashImpactEur: 1500,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: 1500,
      isListed: true, source: "manual",
    }).run();
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const drift = computeDriftSinceSeal(db, 2025);
    expect(drift).not.toBeNull();
    expect(drift!.netComputableEurDelta).toBeCloseTo(500, 2);
  });

  it("getSnapshot returns the stored snapshot when sealed", async () => {
    const db = makeDb();
    seed(db);
    await sealYear({ year: 2025 }, db);
    const snap = getSnapshot(db, 2025);
    expect(snap).not.toBeNull();
    expect(snap!.year).toBe(2025);
  });
});
