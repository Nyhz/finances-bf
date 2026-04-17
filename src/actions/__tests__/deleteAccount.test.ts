import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createAccount } from "../accounts";
import { deleteAccount, deleteAccountSchema } from "../deleteAccount";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("deleteAccount", () => {
  let db: DB;
  let accountId: string;

  beforeEach(async () => {
    db = makeDb();
    const created = await createAccount(
      { name: "Test", accountType: "bank", currency: "EUR", openingBalanceNative: 0 },
      db,
    );
    if (!created.ok) throw new Error("setup failed");
    accountId = created.data.id;
  });

  it("rejects invalid input", async () => {
    expect(deleteAccountSchema.safeParse({}).success).toBe(false);
  });

  it("returns not_found for missing account", async () => {
    const result = await deleteAccount({ id: "missing" }, db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_found");
  });

  it("deletes account with no transactions and writes audit", async () => {
    const result = await deleteAccount({ id: accountId }, db);
    expect(result.ok).toBe(true);
    const remaining = await db.select().from(schema.accounts).all();
    expect(remaining).toHaveLength(0);
    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, accountId))
      .all();
    expect(audit.some((a) => a.action === "delete")).toBe(true);
  });

  it("rejects with conflict when account has asset transactions", async () => {
    const assetId = "ast_1";
    await db
      .insert(schema.assets)
      .values({
        id: assetId,
        name: "Foo",
        assetType: "stock",
        symbol: "FOO",
        currency: "EUR",
      })
      .run();
    await db
      .insert(schema.assetTransactions)
      .values({
        id: "txn_1",
        accountId,
        assetId,
        transactionType: "buy",
        tradedAt: Date.now(),
        quantity: 1,
        unitPrice: 1,
        tradeCurrency: "EUR",
        fxRateToEur: 1,
        tradeGrossAmount: 1,
        tradeGrossAmountEur: 1,
        cashImpactEur: -1,
        netAmountEur: -1,
      })
      .run();

    const result = await deleteAccount({ id: accountId }, db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("conflict");
    expect(result.error.message).toMatch(/transactions or cash movements/);

    const remaining = await db.select().from(schema.accounts).all();
    expect(remaining).toHaveLength(1);
  });

  it("rejects with conflict when account has cash movements", async () => {
    await db
      .insert(schema.accountCashMovements)
      .values({
        id: "cm_1",
        accountId,
        movementType: "deposit",
        occurredAt: Date.now(),
        nativeAmount: 100,
        currency: "EUR",
        fxRateToEur: 1,
        cashImpactEur: 100,
      })
      .run();

    const result = await deleteAccount({ id: accountId }, db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("conflict");
  });
});
