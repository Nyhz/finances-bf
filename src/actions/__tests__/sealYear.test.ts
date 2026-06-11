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
  // countryCode ES: domestic balances are exempt from the M720 gates — keeps
  // these base tests focused on the seal mechanics themselves.
  db.insert(accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", countryCode: "ES", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
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

// Audit T4: sealing freezes M720/M721 values — unvalued foreign balances
// must block the seal unless explicitly acknowledged.
describe("sealYear unvalued-balance gate", () => {
  function seedForeignBuy(db: DB, withValuation: boolean) {
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({
      id: accountId, name: "DEGIRO", currency: "EUR",
      accountType: "broker", countryCode: "NL",
      openingBalanceEur: 0, currentCashBalanceEur: 0,
    }).run();
    db.insert(assets).values({
      id: assetId, name: "VWCE", assetType: "equity",
      currency: "EUR", isActive: true, assetClassTax: "etf",
    }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: Date.UTC(2025, 0, 1),
      quantity: 10, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1000, tradeGrossAmountEur: 1000, cashImpactEur: -1000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -1000,
      isListed: true, source: "manual",
    }).run();
    if (withValuation) {
      db.insert(schema.assetValuations).values({
        id: ulid(), assetId, valuationDate: "2025-12-31",
        quantity: 10, unitPriceEur: 110, marketValueEur: 1100,
        priceSource: "test", createdAt: Date.now(),
      }).run();
    }
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
  }

  it("refuses to seal when a foreign block has unvalued positions", async () => {
    const db = makeDb();
    seedForeignBuy(db, false);
    const res = await sealYear({ year: 2025 }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("conflict");
      expect(res.error.message).toMatch(/sin valorar/);
    }
    expect(db.select().from(taxYearSnapshots).all()).toHaveLength(0);
  });

  it("seals with explicit acknowledgement", async () => {
    const db = makeDb();
    seedForeignBuy(db, false);
    const res = await sealYear({ year: 2025, acknowledgeUnvalued: true }, db);
    expect(res.ok).toBe(true);
    expect(db.select().from(taxYearSnapshots).all()).toHaveLength(1);
  });

  it("seals normally when everything is valued", async () => {
    const db = makeDb();
    seedForeignBuy(db, true);
    const res = await sealYear({ year: 2025 }, db);
    expect(res.ok).toBe(true);
  });
});

// Audit fix 3: balances from accounts without a country land in the "??"
// sentinel block — sealing them needs the same explicit acknowledgement as
// unvalued balances.
describe("sealYear unknown-country gate", () => {
  function seedCountrylessBuy(db: DB) {
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({
      id: accountId, name: "MYSTERY", currency: "EUR",
      accountType: "broker", // no countryCode
      openingBalanceEur: 0, currentCashBalanceEur: 0,
    }).run();
    db.insert(assets).values({
      id: assetId, name: "VWCE", assetType: "equity",
      currency: "EUR", isActive: true, assetClassTax: "etf",
    }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: Date.UTC(2025, 0, 1),
      quantity: 10, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1000, tradeGrossAmountEur: 1000, cashImpactEur: -1000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -1000,
      isListed: true, source: "manual",
    }).run();
    // Valued, so only the unknown-country gate fires.
    db.insert(schema.assetValuations).values({
      id: ulid(), assetId, valuationDate: "2025-12-31",
      quantity: 10, unitPriceEur: 110, marketValueEur: 1100,
      priceSource: "test", createdAt: Date.now(),
    }).run();
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
  }

  it("refuses to seal when a block comes from accounts without a country", async () => {
    const db = makeDb();
    seedCountrylessBuy(db);
    const res = await sealYear({ year: 2025 }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("conflict");
      expect(res.error.message).toMatch(/sin país asignado/);
      expect(res.error.message).toMatch(/\?\?/);
    }
    expect(db.select().from(taxYearSnapshots).all()).toHaveLength(0);
  });

  it("seals with explicit acknowledgement of the unknown country", async () => {
    const db = makeDb();
    seedCountrylessBuy(db);
    const res = await sealYear({ year: 2025, acknowledgeUnknownCountry: true }, db);
    expect(res.ok).toBe(true);
    const row = db.select().from(taxYearSnapshots).all()[0];
    expect(row).toBeDefined();
    // The sentinel block is persisted in the sealed payload, tainted.
    const payload = JSON.parse(row!.payloadJson) as {
      m720: { blocks: Array<{ country: string; hasUnknownCountry?: boolean }> };
    };
    const sentinel = payload.m720.blocks.find((b) => b.country === "??");
    expect(sentinel?.hasUnknownCountry).toBe(true);
  });

  it("acknowledging unvalued alone does not bypass the unknown-country gate", async () => {
    const db = makeDb();
    seedCountrylessBuy(db);
    const res = await sealYear({ year: 2025, acknowledgeUnvalued: true }, db);
    expect(res.ok).toBe(false);
  });
});
