import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { accounts, assets, assetTransactions, taxLots } from "../../db/schema";
import { recomputeLotsForAsset } from "../../server/tax/lots";
import { reimportAccount } from "../reimportAccount";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("reimportAccount", () => {
  it("wipes transactions and tax lots for the account and recomputes affected assets", async () => {
    const db = makeDb();
    const accountId = ulid();
    const assetId = ulid();
    db.insert(accounts).values({
      id: accountId, name: "DEGIRO", currency: "EUR",
      accountType: "broker",
      openingBalanceEur: 0, currentCashBalanceEur: 0,
    }).run();
    db.insert(assets).values({
      id: assetId, name: "VWCE", assetType: "equity", currency: "EUR",
      isActive: true, assetClassTax: "etf",
    }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: Date.UTC(2025, 0, 1),
      quantity: 10, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1000, tradeGrossAmountEur: 1000, cashImpactEur: -1000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -1000,
      isListed: true, source: "manual",
    }).run();
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    expect(db.select().from(taxLots).all()).toHaveLength(1);

    const result = await reimportAccount({ accountId }, db);
    expect(result.ok).toBe(true);
    expect(db.select().from(assetTransactions).where(eq(assetTransactions.accountId, accountId)).all()).toHaveLength(0);
    expect(db.select().from(taxLots).all()).toHaveLength(0);
  });

  it("rejects invalid input", async () => {
    const db = makeDb();
    const result = await reimportAccount({ accountId: "" }, db);
    expect(result.ok).toBe(false);
  });
});
