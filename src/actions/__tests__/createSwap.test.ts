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
import { createSwap } from "../createSwap";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("createSwap", () => {
  it("creates two linked asset_transactions with identical EUR value", async () => {
    const db = makeDb();
    const accountId = ulid(); const btc = ulid(); const eth = ulid();
    db.insert(accounts).values({ id: accountId, name: "BINANCE", currency: "EUR", accountType: "crypto_exchange", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: btc, name: "BTC", assetType: "crypto", currency: "BTC", isActive: true, assetClassTax: "crypto" }).run();
    db.insert(assets).values({ id: eth, name: "ETH", assetType: "crypto", currency: "ETH", isActive: true, assetClassTax: "crypto" }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId: btc,
      transactionType: "buy", tradedAt: Date.UTC(2024, 5, 1),
      quantity: 0.5, unitPrice: 30000,
      tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 15000, tradeGrossAmountEur: 15000, cashImpactEur: -15000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -15000,
      isListed: false, source: "manual",
    }).run();

    const result = await createSwap({
      accountId, tradeDate: "2025-03-15",
      outgoingAssetId: btc, outgoingQuantity: 0.1,
      incomingAssetId: eth, incomingQuantity: 1.8,
      valueEur: 4500,
    }, db);

    expect(result.ok).toBe(true);
    const sellLeg = db.select().from(assetTransactions).where(eq(assetTransactions.assetId, btc)).all().find((t) => t.transactionType === "sell");
    const buyLeg = db.select().from(assetTransactions).where(eq(assetTransactions.assetId, eth)).all().find((t) => t.transactionType === "buy");
    expect(sellLeg).toBeDefined();
    expect(buyLeg).toBeDefined();
    expect(sellLeg!.tradeGrossAmountEur).toBe(4500);
    expect(buyLeg!.tradeGrossAmountEur).toBe(4500);
    expect(sellLeg!.linkedTransactionId).toBe(buyLeg!.id);
    expect(buyLeg!.linkedTransactionId).toBe(sellLeg!.id);
  });

  it("rejects when outgoing or incoming asset not found", async () => {
    const db = makeDb();
    const result = await createSwap({
      accountId: "nonexistent", tradeDate: "2025-03-15",
      outgoingAssetId: "a", outgoingQuantity: 1,
      incomingAssetId: "b", incomingQuantity: 1,
      valueEur: 100,
    }, db);
    expect(result.ok).toBe(false);
  });

  it("rejects a swap between the same asset at the schema", async () => {
    const db = makeDb();
    const result = await createSwap({
      accountId: "acc", tradeDate: "2025-03-15",
      outgoingAssetId: "same", outgoingQuantity: 1,
      incomingAssetId: "same", incomingQuantity: 1,
      valueEur: 100,
    }, db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
    expect(result.error.fieldErrors?.incomingAssetId?.[0]).toMatch(/distinto del saliente/);
  });
});

describe("createSwap duplicate handling", () => {
  function seed(db: DB) {
    const accountId = ulid(); const btc = ulid(); const eth = ulid();
    db.insert(accounts).values({ id: accountId, name: "BINANCE", currency: "EUR", accountType: "crypto_exchange", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: btc, name: "BTC", assetType: "crypto", currency: "BTC", isActive: true, assetClassTax: "crypto" }).run();
    db.insert(assets).values({ id: eth, name: "ETH", assetType: "crypto", currency: "ETH", isActive: true, assetClassTax: "crypto" }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId: btc,
      transactionType: "buy", tradedAt: Date.UTC(2024, 5, 1),
      quantity: 1, unitPrice: 30000,
      tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 30000, tradeGrossAmountEur: 30000, cashImpactEur: -30000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -30000,
      isListed: false, source: "manual",
    }).run();
    return { accountId, btc, eth };
  }
  const payload = (accountId: string, btc: string, eth: string) => ({
    accountId, tradeDate: "2025-03-15",
    outgoingAssetId: btc, outgoingQuantity: 0.1,
    incomingAssetId: eth, incomingQuantity: 1.8,
    valueEur: 4500,
  });

  it("each leg gets its own fingerprint and they differ", async () => {
    const db = makeDb();
    const { accountId, btc, eth } = seed(db);
    const result = await createSwap(payload(accountId, btc, eth), db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sell = db.select().from(assetTransactions).where(eq(assetTransactions.id, result.data.sellId)).get();
    const buy = db.select().from(assetTransactions).where(eq(assetTransactions.id, result.data.buyId)).get();
    expect(sell?.rowFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(buy?.rowFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(sell?.rowFingerprint).not.toBe(buy?.rowFingerprint);
  });

  it("returns code=duplicate for a second identical swap", async () => {
    const db = makeDb();
    const { accountId, btc, eth } = seed(db);
    const first = await createSwap(payload(accountId, btc, eth), db);
    expect(first.ok).toBe(true);
    const second = await createSwap(payload(accountId, btc, eth), db);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("duplicate");
    // 1 seed buy + 2 swap legs, nothing more.
    expect(db.select().from(assetTransactions).all()).toHaveLength(3);
  });

  it("records both swaps with allowDuplicate=true (salted fingerprints)", async () => {
    const db = makeDb();
    const { accountId, btc, eth } = seed(db);
    const first = await createSwap(payload(accountId, btc, eth), db);
    expect(first.ok).toBe(true);
    const second = await createSwap(
      { ...payload(accountId, btc, eth), allowDuplicate: true }, db,
    );
    expect(second.ok).toBe(true);
    const rows = db
      .select()
      .from(assetTransactions)
      .all()
      .filter((r) => r.rowFingerprint != null);
    expect(rows).toHaveLength(4); // two legs per swap
    const fingerprints = new Set(rows.map((r) => r.rowFingerprint));
    expect(fingerprints.size).toBe(4); // salted, no collision
  });
});

describe("createSwap audit trail", () => {
  it("stores both inserted legs in the audit event's nextJson", async () => {
    const db = makeDb();
    const accountId = ulid(); const btc = ulid(); const eth = ulid();
    db.insert(accounts).values({ id: accountId, name: "BINANCE", currency: "EUR", accountType: "crypto_exchange", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: btc, name: "BTC", assetType: "crypto", currency: "BTC", isActive: true, assetClassTax: "crypto" }).run();
    db.insert(assets).values({ id: eth, name: "ETH", assetType: "crypto", currency: "ETH", isActive: true, assetClassTax: "crypto" }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId: btc,
      transactionType: "buy", tradedAt: Date.UTC(2024, 5, 1),
      quantity: 1, unitPrice: 30000,
      tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 30000, tradeGrossAmountEur: 30000, cashImpactEur: -30000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -30000,
      isListed: false, source: "manual",
    }).run();

    const result = await createSwap({
      accountId, tradeDate: "2025-03-15",
      outgoingAssetId: btc, outgoingQuantity: 0.1,
      incomingAssetId: eth, incomingQuantity: 1.8,
      valueEur: 4500,
    }, db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const audit = db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, result.data.sellId))
      .get();
    expect(audit?.action).toBe("create-swap");
    const next = JSON.parse(audit!.nextJson!) as { sell: { id: string }; buy: { id: string } };
    expect(next.sell.id).toBe(result.data.sellId);
    expect(next.buy.id).toBe(result.data.buyId);
  });
});
