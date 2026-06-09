import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "../../../db/schema";
import type { DB } from "../../../db/client";
import { accounts, assets, assetTransactions, taxYearSnapshots } from "../../../db/schema";
import { recomputeLotsForAsset } from "../lots";
import { buildTaxReport } from "../report";
import { computeDriftSinceSeal, getSnapshot , getSnapshotState } from "../seals";
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

// Audit R9: a sealed row with an unreadable payload must surface as corrupt,
// not silently behave like an unsealed year.
describe("getSnapshotState corruption handling", () => {
  it("flags garbage payloadJson as corrupt", () => {
    const db = makeDb();
    db.insert(taxYearSnapshots).values({
      id: ulid(), year: 2024, sealedAt: 123,
      payloadJson: "{ this is not json",
    }).run();
    const state = getSnapshotState(db, 2024);
    expect(state.status).toBe("corrupt");
    expect(getSnapshot(db, 2024)).toBeNull();
  });

  it("flags a payload without a report as corrupt", () => {
    const db = makeDb();
    db.insert(taxYearSnapshots).values({
      id: ulid(), year: 2024, sealedAt: 123,
      payloadJson: JSON.stringify({ m720: { blocks: [] } }),
    }).run();
    expect(getSnapshotState(db, 2024).status).toBe("corrupt");
  });

  it("accepts a pre-Phase-2 payload shape (no valuation flags) as ok", () => {
    const db = makeDb();
    // Old snapshots: yearEndBalances rows without unvalued/staleValuation and
    // blocks without hasUnvalued/hasStale must still load.
    const oldPayload = {
      report: {
        year: 2024, sales: [], dividends: [],
        yearEndBalances: [{
          accountId: "a", accountName: "X", accountCountry: "NL",
          accountType: "broker", assetId: "y", assetName: "VWCE",
          isin: null, assetClassTax: "etf", quantity: 1, valueEur: 100,
        }],
        totals: {},
      },
      m720: { blocks: [{ country: "NL", type: "broker-securities", valueEur: 100, status: "ok", lastDeclaredEur: null }] },
      m721: { blocks: [] },
      d6: { blocks: [] },
    };
    db.insert(taxYearSnapshots).values({
      id: ulid(), year: 2024, sealedAt: 123,
      payloadJson: JSON.stringify(oldPayload),
    }).run();
    const state = getSnapshotState(db, 2024);
    expect(state.status).toBe("ok");
  });
});

// Audit T12: compensating edits (same totals, different composition) are
// caught by the content hash.
describe("drift content hash", () => {
  it("detects a swap of one sale for an equal-net other", async () => {
    const db = makeDb();
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "B", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: assetId, name: "X", assetType: "equity", currency: "EUR", isActive: true, assetClassTax: "listed_security" }).run();
    const mkTrade = (type: "buy" | "sell", qty: number, price: number, month: number) => {
      const id = ulid();
      const gross = qty * price;
      db.insert(assetTransactions).values({
        id, accountId, assetId,
        transactionType: type, tradedAt: Date.UTC(2025, month, 1),
        quantity: qty, unitPrice: price, tradeCurrency: "EUR", fxRateToEur: 1,
        tradeGrossAmount: gross, tradeGrossAmountEur: gross,
        cashImpactEur: type === "buy" ? -gross : gross,
        feesAmount: 0, feesAmountEur: 0, netAmountEur: type === "buy" ? -gross : gross,
        isListed: true, source: "manual",
      }).run();
      return id;
    };
    mkTrade("buy", 20, 100, 0);
    const sellId = mkTrade("sell", 10, 110, 5); // +100 gain
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const { sealYear } = await import("../../../actions/sealYear");
    const sealed = await sealYear({ year: 2025 }, db);
    expect(sealed.ok).toBe(true);

    // Compensating edit: remove the sale, add a different one with the SAME
    // gain (sell 5 @ 120 → +100) on another date.
    db.delete(schema.taxWashSaleAdjustments).run();
    db.delete(schema.taxLotConsumptions).run();
    db.delete(assetTransactions).where(eq(assetTransactions.id, sellId)).run();
    mkTrade("sell", 5, 120, 7);
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const live = buildTaxReport(db, 2025);
    expect(live.totals.netComputableEur).toBeCloseTo(100, 2);

    const drift = computeDriftSinceSeal(db, 2025);
    expect(drift).not.toBeNull();
    expect(drift?.contentChanged).toBe(true);
    expect(drift?.netComputableEurDelta).toBe(0);
  });
});
