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
import { deleteCashMovement } from "../deleteCashMovement";
import { getLedgerForAccount } from "../../server/transactions";

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
      fxEurToCcy: 1 / 0.92,
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
    expect(row?.rowFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("createDividend duplicate handling", () => {
  function seed(db: DB) {
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: assetId, name: "UNH", assetType: "equity", isin: "US91324P1021", currency: "EUR", isActive: true, assetClassTax: "listed_security" }).run();
    return { accountId, assetId };
  }
  const payload = (accountId: string, assetId: string) => ({
    accountId, assetId,
    tradeDate: "2025-03-17",
    grossNative: 6.63,
    currency: "EUR",
  });

  it("returns code=duplicate for a second identical dividend", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    const first = await createDividend(payload(accountId, assetId), db);
    expect(first.ok).toBe(true);
    const second = await createDividend(payload(accountId, assetId), db);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("duplicate");
    expect(db.select().from(assetTransactions).all()).toHaveLength(1);
  });

  it("records both dividends with allowDuplicate=true (salted fingerprint)", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    const first = await createDividend(payload(accountId, assetId), db);
    expect(first.ok).toBe(true);
    const second = await createDividend(
      { ...payload(accountId, assetId), allowDuplicate: true }, db,
    );
    expect(second.ok).toBe(true);
    const rows = db.select().from(assetTransactions).all();
    expect(rows).toHaveLength(2);
    const fingerprints = new Set(rows.map((r) => r.rowFingerprint));
    expect(fingerprints.size).toBe(2); // salted, no collision
  });
});

describe("createDividend paired cash movement", () => {
  function seedSavings(db: DB) {
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "Bank", currency: "EUR", accountType: "savings", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: assetId, name: "UNH", assetType: "equity", isin: "US91324P1021", currency: "EUR", isActive: true, assetClassTax: "listed_security" }).run();
    return { accountId, assetId };
  }

  it("the cash shadow is hidden from the ledger (transaction row listed once)", async () => {
    const db = makeDb();
    const { accountId, assetId } = seedSavings(db);
    const result = await createDividend({
      accountId, assetId,
      tradeDate: "2025-03-17",
      grossNative: 100,
      currency: "EUR",
    }, db);
    expect(result.ok).toBe(true);
    // The paired movement exists…
    const movement = db.select().from(schema.accountCashMovements).get();
    expect(movement?.movementType).toBe("dividend");
    expect(movement?.externalReference).not.toBeNull();
    // …but the ledger lists the dividend exactly once (the transaction row).
    const ledger = await getLedgerForAccount(accountId, {}, db);
    // Both the transaction row and the cash shadow carry label "dividend".
    const dividendEntries = ledger.items.filter((e) => e.label === "dividend");
    expect(dividendEntries).toHaveLength(1);
    expect(dividendEntries[0].kind).toBe("transaction");
  });

  it("the cash shadow cannot be deleted on its own", async () => {
    const db = makeDb();
    const { accountId, assetId } = seedSavings(db);
    const result = await createDividend({
      accountId, assetId,
      tradeDate: "2025-03-17",
      grossNative: 100,
      currency: "EUR",
    }, db);
    expect(result.ok).toBe(true);
    const movement = db.select().from(schema.accountCashMovements).get();
    expect(movement).toBeDefined();
    const del = await deleteCashMovement({ id: movement!.id }, db);
    expect(del.ok).toBe(false);
    if (del.ok) return;
    expect(del.error.code).toBe("conflict");
    expect(del.error.message).toMatch(/reflejo de caja/);
    // The movement survives the rejected delete.
    expect(db.select().from(schema.accountCashMovements).all()).toHaveLength(1);
  });
});

// Audit T1 / test R-2: a non-EUR dividend must never default to FX rate 1 —
// and since the manual-FX rework, must never default to the stored daily
// rate either: the broker's EUR→CCY rate is always typed by hand.
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

  it("rejects a USD dividend without a manual rate", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    const result = await createDividend(payload(accountId, assetId), db);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
      expect(result.error.fieldErrors?.fxEurToCcy?.[0]).toMatch(/Obligatorio|tipo/i);
    }
    expect(db.select().from(assetTransactions).all()).toHaveLength(0);
  });

  it("rejects even when a stored daily rate EXISTS — daily rates never apply", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    db.insert(schema.fxRates).values({
      id: ulid(), currency: "USD", date: "2025-03-17",
      rateToEur: 0.9, source: "yahoo-fx", createdAt: Date.now(),
    }).run();
    const result = await createDividend(payload(accountId, assetId), db);
    expect(result.ok).toBe(false);
    expect(db.select().from(assetTransactions).all()).toHaveLength(0);
  });

  it("the manual EUR→CCY rate is inverted once and stamps fxSource=explicit", async () => {
    const db = makeDb();
    const { accountId, assetId } = seed(db);
    const result = await createDividend(
      { ...payload(accountId, assetId), fxEurToCcy: 1 / 0.92 }, db,
    );
    expect(result.ok).toBe(true);
    const row = db.select().from(assetTransactions).get();
    expect(row?.fxSource).toBe("explicit");
    expect(row?.fxRateToEur).toBeCloseTo(0.92, 9);
    expect(row?.tradeGrossAmountEur).toBeCloseTo(92, 2);
    expect(row?.withholdingTax).toBeCloseTo(13.8, 2);
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
