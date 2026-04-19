import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { accounts, assets, assetTransactions, taxYearSnapshots } from "../../db/schema";
import { recomputeLotsForAsset } from "../../server/tax/lots";
import { sealYear } from "../sealYear";
import { unsealYear } from "../unsealYear";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedBuy(db: DB) {
  const accountId = ulid(); const assetId = ulid();
  db.insert(accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
  db.insert(assets).values({ id: assetId, name: "VWCE", assetType: "equity", currency: "EUR", isActive: true, assetClassTax: "etf" }).run();
  db.insert(assetTransactions).values({
    id: ulid(), accountId, assetId,
    transactionType: "buy", tradedAt: Date.UTC(2025, 0, 1),
    quantity: 10, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
    tradeGrossAmount: 1000, tradeGrossAmountEur: 1000, cashImpactEur: -1000,
    feesAmount: 0, feesAmountEur: 0, netAmountEur: -1000,
    isListed: true, source: "manual",
  }).run();
  db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
}

describe("sealYear / unsealYear", () => {
  it("seals a year by writing a tax_year_snapshots row", async () => {
    const db = makeDb();
    seedBuy(db);
    const res = await sealYear({ year: 2025 }, db);
    expect(res.ok).toBe(true);
    const row = db.select().from(taxYearSnapshots).where(eq(taxYearSnapshots.year, 2025)).get();
    expect(row).toBeDefined();
    expect(row!.payloadJson.length).toBeGreaterThan(10);
  });

  it("rejects sealing a year already sealed", async () => {
    const db = makeDb();
    const first = await sealYear({ year: 2025 }, db);
    expect(first.ok).toBe(true);
    const again = await sealYear({ year: 2025 }, db);
    expect(again.ok).toBe(false);
  });

  it("unseals a sealed year", async () => {
    const db = makeDb();
    await sealYear({ year: 2025 }, db);
    const unsealed = await unsealYear({ year: 2025 }, db);
    expect(unsealed.ok).toBe(true);
    expect(db.select().from(taxYearSnapshots).where(eq(taxYearSnapshots.year, 2025)).all()).toHaveLength(0);
  });
});
