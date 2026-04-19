import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "../../../db/schema";
import type { DB } from "../../../db/client";
import {
  accounts,
  assets,
  assetTransactions,
  taxLots,
  taxWashSaleAdjustments,
} from "../../../db/schema";
import { recomputeLotsForAsset } from "../lots";

const DAY = 86_400_000;

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seed(db: DB, assetClass: "listed_security" | "unlisted_security") {
  const accountId = ulid();
  const assetId = ulid();
  db.insert(accounts).values({
    id: accountId, name: "DEGIRO", currency: "EUR",
    accountType: "broker",
    openingBalanceEur: 0, currentCashBalanceEur: 0,
  }).run();
  db.insert(assets).values({
    id: assetId, name: "Test Equity",
    assetType: "equity", currency: "EUR",
    isActive: true, assetClassTax: assetClass,
  }).run();
  return { accountId, assetId };
}

function trade(db: DB, accountId: string, assetId: string, type: "buy" | "sell", qty: number, price: number, tradedAt: number): string {
  const gross = qty * price;
  const id = ulid();
  db.insert(assetTransactions).values({
    id, accountId, assetId,
    transactionType: type,
    tradedAt, quantity: qty, unitPrice: price,
    tradeCurrency: "EUR", fxRateToEur: 1,
    tradeGrossAmount: gross, tradeGrossAmountEur: gross,
    cashImpactEur: type === "buy" ? -gross : gross,
    feesAmount: 0, feesAmountEur: 0,
    netAmountEur: type === "buy" ? -gross : gross,
    isListed: true, source: "manual",
  }).run();
  return id;
}

describe("wash-sale rule", () => {
  it("flags a loss as disallowed when repurchase happens within 60 days (listed)", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "listed_security");
    const t0 = Date.UTC(2025, 0, 1);
    trade(db, accountId, assetId, "buy",  10, 100, t0);
    const sell = trade(db, accountId, assetId, "sell", 10, 80, t0 + 30 * DAY);
    trade(db, accountId, assetId, "buy",  10, 85,  t0 + 45 * DAY);

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, sell)).all();
    expect(adj).toHaveLength(1);
    expect(adj[0].disallowedLossEur).toBeCloseTo(200, 2);
    expect(adj[0].windowDays).toBe(60);

    const absorbing = db.select().from(taxLots).where(eq(taxLots.id, adj[0].absorbingLotId)).get();
    expect(absorbing!.deferredLossAddedEur).toBeCloseTo(200, 2);
  });

  it("uses 365-day window for unlisted securities", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "unlisted_security");
    const t0 = Date.UTC(2025, 0, 1);
    trade(db, accountId, assetId, "buy",  5, 100, t0);
    const sell = trade(db, accountId, assetId, "sell", 5, 80, t0 + 200 * DAY);
    trade(db, accountId, assetId, "buy",  5, 85,  t0 + 210 * DAY);

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, sell)).all();
    expect(adj).toHaveLength(1);
    expect(adj[0].windowDays).toBe(365);
  });

  it("does not flag a sale that ends at a gain", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "listed_security");
    const t0 = Date.UTC(2025, 0, 1);
    trade(db, accountId, assetId, "buy",  10, 100, t0);
    const sell = trade(db, accountId, assetId, "sell", 10, 110, t0 + 30 * DAY);
    trade(db, accountId, assetId, "buy",  10, 105, t0 + 45 * DAY);

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, sell)).all();
    expect(adj).toHaveLength(0);
  });

  it("partial absorption when repurchased qty < sold qty", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db, "listed_security");
    const t0 = Date.UTC(2025, 0, 1);
    trade(db, accountId, assetId, "buy",  10, 100, t0);
    const sell = trade(db, accountId, assetId, "sell", 10, 80, t0 + 30 * DAY);
    trade(db, accountId, assetId, "buy",  3,  85,  t0 + 45 * DAY);

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, sell)).all();
    expect(adj).toHaveLength(1);
    // disallowed = 200 * (3/10) = 60
    expect(adj[0].disallowedLossEur).toBeCloseTo(60, 2);
  });
});
