import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { accounts, assets, assetTransactions } from "../../db/schema";
import { createDividend } from "../createDividend";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("createDividend", () => {
  it("writes a dividend asset_transactions row with retenciones and source country", async () => {
    const db = makeDb();
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: assetId, name: "UNH", assetType: "equity", isin: "US91324P1021", currency: "USD", isActive: true, assetClassTax: "listed_security" }).run();

    const result = await createDividend({
      accountId, assetId,
      tradeDate: "2025-03-17",
      grossNative: 6.63,
      currency: "USD",
      fxRateToEur: 0.92,
      withholdingOrigenNative: 0.99,
      withholdingDestinoEur: 0,
      sourceCountry: "US",
    }, db);

    expect(result.ok).toBe(true);
    const row = db.select().from(assetTransactions).where(eq(assetTransactions.assetId, assetId)).get();
    expect(row?.transactionType).toBe("dividend");
    expect(row?.sourceCountry).toBe("US");
    expect(row?.withholdingTax).toBeCloseTo(0.99 * 0.92, 2);
    expect(row?.tradeGrossAmountEur).toBeCloseTo(6.63 * 0.92, 2);
  });
});

// Audit T1 / test R-2: a non-EUR dividend must never default to FX rate 1.
describe("createDividend FX resolution", () => {
  function seed(db: DB) {
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: assetId, name: "UNH", assetType: "equity", isin: "US91324P1021", currency: "USD", isActive: true, assetClassTax: "listed_security" }).run();
    return { accountId, assetId };
  }
  const payload = (accountId: string, assetId: string) => ({
    accountId, assetId,
    tradeDate: "2025-03-17",
    grossNative: 100,
    currency: "USD",
    withholdingOrigenNative: 15,
    withholdingDestinoEur: 0,
    sourceCountry: "US",
  });

  it("rejects a USD dividend with no explicit rate and no stored rate", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    const result = await createDividend(payload(accountId, assetId), db);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
      expect(result.error.fieldErrors?.fxRateToEur?.[0]).toMatch(/FX rate/);
    }
    expect(db.select().from(assetTransactions).all()).toHaveLength(0);
  });

  it("resolves from fx_rates when no explicit rate is given, stamping fxSource", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    db.insert(schema.fxRates).values({
      id: ulid(), currency: "USD", date: "2025-03-17",
      rateToEur: 0.9, source: "yahoo-fx", createdAt: Date.now(),
    }).run();
    const result = await createDividend(payload(accountId, assetId), db);
    expect(result.ok).toBe(true);
    const row = db.select().from(assetTransactions).get();
    expect(row?.fxRateToEur).toBeCloseTo(0.9, 9);
    expect(row?.fxSource).toBe("historical");
    expect(row?.tradeGrossAmountEur).toBeCloseTo(90, 2);
    expect(row?.withholdingTax).toBeCloseTo(13.5, 2);
  });

  it("falls back to the latest earlier rate and marks it stale (fxSource=latest)", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    db.insert(schema.fxRates).values({
      id: ulid(), currency: "USD", date: "2025-03-10",
      rateToEur: 0.95, source: "yahoo-fx", createdAt: Date.now(),
    }).run();
    const result = await createDividend(payload(accountId, assetId), db);
    expect(result.ok).toBe(true);
    const row = db.select().from(assetTransactions).get();
    expect(row?.fxRateToEur).toBeCloseTo(0.95, 9);
    expect(row?.fxSource).toBe("latest");
  });

  it("explicit user rate wins and stamps fxSource=explicit", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    const result = await createDividend({ ...payload(accountId, assetId), fxRateToEur: 0.92 }, db);
    expect(result.ok).toBe(true);
    const row = db.select().from(assetTransactions).get();
    expect(row?.fxSource).toBe("explicit");
    expect(row?.tradeGrossAmountEur).toBeCloseTo(92, 2);
  });

  it("EUR dividends need no rate and stamp fxSource=unit", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    const result = await createDividend(
      { ...payload(accountId, assetId), currency: "EUR" }, db,
    );
    expect(result.ok).toBe(true);
    const row = db.select().from(assetTransactions).get();
    expect(row?.fxRateToEur).toBe(1);
    expect(row?.fxSource).toBe("unit");
  });
});
