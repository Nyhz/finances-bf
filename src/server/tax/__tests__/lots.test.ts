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
  taxLotConsumptions,
} from "../../../db/schema";
import { recomputeLotsForAsset } from "../lots";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seed(db: DB) {
  const accountId = ulid();
  const assetId = ulid();
  db.insert(accounts).values({
    id: accountId, name: "DEGIRO", currency: "EUR",
    accountType: "broker",
    openingBalanceEur: 0, currentCashBalanceEur: 0,
  }).run();
  db.insert(assets).values({
    id: assetId, name: "VWCE",
    assetType: "equity", isin: "IE00BK5BQT80",
    currency: "EUR", isActive: true, assetClassTax: "etf",
  }).run();
  return { accountId, assetId };
}

function insertTrade(db: DB, accountId: string, assetId: string, opts: {
  type: "buy" | "sell"; qty: number; unitPriceEur: number; feesEur: number; tradedAt: number;
}): string {
  const id = ulid();
  const gross = opts.qty * opts.unitPriceEur;
  db.insert(assetTransactions).values({
    id, accountId, assetId,
    transactionType: opts.type,
    tradedAt: opts.tradedAt,
    quantity: opts.qty, unitPrice: opts.unitPriceEur,
    tradeCurrency: "EUR", fxRateToEur: 1,
    tradeGrossAmount: gross, tradeGrossAmountEur: gross,
    cashImpactEur: opts.type === "buy" ? -(gross + opts.feesEur) : gross - opts.feesEur,
    feesAmount: opts.feesEur, feesAmountEur: opts.feesEur,
    netAmountEur: opts.type === "buy" ? -(gross + opts.feesEur) : gross - opts.feesEur,
    isListed: true, source: "manual",
  }).run();
  return id;
}

describe("recomputeLotsForAsset", () => {
  it("creates a lot per buy and consumes lots FIFO on sell", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    const buy1 = insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 100, feesEur: 2, tradedAt: Date.UTC(2025, 0, 1) });
    const buy2 = insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 120, feesEur: 2, tradedAt: Date.UTC(2025, 1, 1) });
    const sell = insertTrade(db, accountId, assetId, { type: "sell", qty: 15, unitPriceEur: 130, feesEur: 3, tradedAt: Date.UTC(2025, 6, 1) });

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const lots = db.select().from(taxLots).where(eq(taxLots.assetId, assetId)).all();
    expect(lots).toHaveLength(2);
    const firstLot = lots.find((l) => l.originTransactionId === buy1)!;
    const secondLot = lots.find((l) => l.originTransactionId === buy2)!;
    expect(firstLot.remainingQty).toBe(0);
    expect(secondLot.remainingQty).toBe(5);

    const consumptions = db.select().from(taxLotConsumptions).where(eq(taxLotConsumptions.saleTransactionId, sell)).all();
    expect(consumptions).toHaveLength(2);
    const c1 = consumptions.find((c) => c.lotId === firstLot.id)!;
    const c2 = consumptions.find((c) => c.lotId === secondLot.id)!;
    expect(c1.qtyConsumed).toBe(10);
    expect(c2.qtyConsumed).toBe(5);
    // unit cost of buy1 = 1002 / 10 = 100.2 → consumed = 1002
    expect(c1.costBasisEur).toBeCloseTo(1002, 4);
    // unit cost of buy2 = 1202 / 10 = 120.2 → 5 * 120.2 = 601
    expect(c2.costBasisEur).toBeCloseTo(601, 4);
  });

  it("is idempotent", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    insertTrade(db, accountId, assetId, { type: "buy", qty: 5, unitPriceEur: 10, feesEur: 0, tradedAt: Date.UTC(2025, 0, 1) });

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    const first = db.select().from(taxLots).all();
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    const second = db.select().from(taxLots).all();

    expect(second).toHaveLength(first.length);
    const projection = (rows: typeof first) => rows.map((r) => ({
      remainingQty: r.remainingQty,
      unitCostEur: r.unitCostEur,
      originalQty: r.originalQty,
      originTransactionId: r.originTransactionId,
    }));
    expect(projection(second)).toEqual(projection(first));
  });

  it("throws when a sell exceeds available lots", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    insertTrade(db, accountId, assetId, { type: "buy",  qty: 5,  unitPriceEur: 100, feesEur: 0, tradedAt: Date.UTC(2025, 0, 1) });
    insertTrade(db, accountId, assetId, { type: "sell", qty: 10, unitPriceEur: 120, feesEur: 0, tradedAt: Date.UTC(2025, 1, 1) });
    expect(() => {
      db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    }).toThrow(/oversells/);
  });

  it("ignores dividend transactions", () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "dividend",
      tradedAt: Date.UTC(2025, 5, 1),
      quantity: 0, unitPrice: 0,
      tradeCurrency: "USD", fxRateToEur: 0.92,
      tradeGrossAmount: 6.63, tradeGrossAmountEur: 6.1,
      cashImpactEur: 5.2, feesAmount: 0, feesAmountEur: 0,
      netAmountEur: 5.2,
      isListed: true, source: "manual",
    }).run();

    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    expect(db.select().from(taxLots).all()).toHaveLength(0);
  });
});
