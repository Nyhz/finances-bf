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
});
