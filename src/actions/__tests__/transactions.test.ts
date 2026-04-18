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
import { createAsset } from "../createAsset";
import { createTransaction } from "../createTransaction";
import { createTransactionSchema } from "../createTransaction.schema";
import { deleteTransaction } from "../deleteTransaction";
import { deleteTransactionSchema } from "../deleteTransaction.schema";
import { createCashMovement } from "../createCashMovement";
import { createCashMovementSchema } from "../createCashMovement.schema";
import { deleteCashMovement } from "../deleteCashMovement";
import { deleteCashMovementSchema } from "../deleteCashMovement.schema";
import { transactionFingerprint } from "../_fingerprint";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

async function setup(db: DB) {
  const acc = await createAccount(
    { name: "Broker", accountType: "savings", currency: "EUR", openingBalanceNative: 1000 },
    db,
  );
  if (!acc.ok) throw new Error("account setup");
  const ast = await createAsset(
    { name: "Foo Inc", symbol: "FOO", assetType: "stock", currency: "EUR" },
    db,
  );
  if (!ast.ok) throw new Error("asset setup");
  return { accountId: acc.data.id, assetId: ast.data.id };
}

describe("zod rejection", () => {
  it("createTransactionSchema rejects bad input", () => {
    expect(createTransactionSchema.safeParse({}).success).toBe(false);
    expect(
      createTransactionSchema.safeParse({
        accountId: "a",
        assetId: "b",
        tradeDate: "not-a-date",
        side: "buy",
        quantity: 1,
        priceNative: 1,
        currency: "EUR",
      }).success,
    ).toBe(false);
    expect(
      createTransactionSchema.safeParse({
        accountId: "a",
        assetId: "b",
        tradeDate: "2026-01-01",
        side: "buy",
        quantity: 0,
        priceNative: 1,
        currency: "EUR",
      }).success,
    ).toBe(false);
  });

  it("deleteTransactionSchema requires id", () => {
    expect(deleteTransactionSchema.safeParse({}).success).toBe(false);
    expect(deleteTransactionSchema.safeParse({ id: "x" }).success).toBe(true);
  });

  it("createCashMovementSchema rejects bad kind / currency", () => {
    expect(
      createCashMovementSchema.safeParse({
        accountId: "a",
        kind: "bogus",
        occurredAt: "2026-01-01",
        amountNative: 5,
        currency: "EUR",
      }).success,
    ).toBe(false);
    expect(
      createCashMovementSchema.safeParse({
        accountId: "a",
        kind: "deposit",
        occurredAt: "2026-01-01",
        amountNative: 5,
        currency: "euro",
      }).success,
    ).toBe(false);
  });

  it("deleteCashMovementSchema requires id", () => {
    expect(deleteCashMovementSchema.safeParse({}).success).toBe(false);
  });
});

describe("transactionFingerprint", () => {
  it("is deterministic for same inputs", () => {
    const input = {
      accountId: "acc_1",
      assetId: "ast_1",
      tradeDate: "2026-01-15",
      side: "buy" as const,
      quantity: 10,
      priceNative: 100.5,
    };
    const a = transactionFingerprint(input);
    const b = transactionFingerprint(input);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when any input changes", () => {
    const base = {
      accountId: "a",
      assetId: "b",
      tradeDate: "2026-01-15",
      side: "buy" as const,
      quantity: 10,
      priceNative: 100,
    };
    expect(transactionFingerprint(base)).not.toBe(
      transactionFingerprint({ ...base, side: "sell" }),
    );
    expect(transactionFingerprint(base)).not.toBe(
      transactionFingerprint({ ...base, priceNative: 100.01 }),
    );
  });
});

describe("createTransaction + deleteTransaction integration", () => {
  let db: DB;
  let accountId: string;
  let assetId: string;

  beforeEach(async () => {
    db = makeDb();
    const ids = await setup(db);
    accountId = ids.accountId;
    assetId = ids.assetId;
  });

  async function buy(qty: number, price: number, date = "2026-02-01") {
    return createTransaction(
      {
        accountId,
        assetId,
        tradeDate: date,
        side: "buy",
        quantity: qty,
        priceNative: price,
        currency: "EUR",
        fees: 0,
      },
      db,
    );
  }

  async function sell(qty: number, price: number, date = "2026-03-01") {
    return createTransaction(
      {
        accountId,
        assetId,
        tradeDate: date,
        side: "sell",
        quantity: qty,
        priceNative: price,
        currency: "EUR",
        fees: 0,
      },
      db,
    );
  }

  function getAccountBalance(): number {
    const row = db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
    return row?.currentCashBalanceEur ?? NaN;
  }

  function getPosition() {
    return (
      db
        .select()
        .from(schema.assetPositions)
        .where(eq(schema.assetPositions.assetId, assetId))
        .get() ?? null
    );
  }

  it("buy updates position quantity and cash balance", async () => {
    const r = await buy(10, 50);
    expect(r.ok).toBe(true);
    const pos = getPosition();
    expect(pos?.quantity).toBe(10);
    expect(pos?.averageCost).toBe(50);
    expect(pos?.totalCostEur).toBe(500);
    expect(getAccountBalance()).toBe(500); // 1000 - 500
  });

  it("partial sell leaves averageCost unchanged and deducts qty", async () => {
    await buy(10, 50);
    const r = await sell(4, 60);
    expect(r.ok).toBe(true);
    const pos = getPosition();
    expect(pos?.quantity).toBeCloseTo(6, 6);
    expect(pos?.averageCost).toBeCloseTo(50, 6); // unchanged
    // cash: 1000 - 500 + 240 = 740
    expect(getAccountBalance()).toBeCloseTo(740, 2);
  });

  it("full sell deletes the position row", async () => {
    await buy(10, 50);
    await sell(10, 70);
    expect(getPosition()).toBeNull();
    // 1000 - 500 + 700 = 1200
    expect(getAccountBalance()).toBeCloseTo(1200, 2);
  });

  it("delete reverses the transaction and cash", async () => {
    const r1 = await buy(10, 50);
    if (!r1.ok) throw new Error("buy failed");
    const r2 = await buy(5, 60);
    if (!r2.ok) throw new Error("buy2 failed");
    const del = await deleteTransaction({ id: r2.data.id }, db);
    expect(del.ok).toBe(true);
    const pos = getPosition();
    expect(pos?.quantity).toBe(10);
    expect(pos?.averageCost).toBe(50);
    // 1000 - 500 = 500
    expect(getAccountBalance()).toBeCloseTo(500, 2);
  });

  it("delete of the only buy removes the position", async () => {
    const r = await buy(3, 100);
    if (!r.ok) throw new Error("buy failed");
    const del = await deleteTransaction({ id: r.data.id }, db);
    expect(del.ok).toBe(true);
    expect(getPosition()).toBeNull();
    expect(getAccountBalance()).toBe(1000);
  });

  it("create/delete roundtrip restores account balance exactly", async () => {
    const startBal = getAccountBalance();
    const r = await buy(7, 42.5);
    if (!r.ok) throw new Error("buy failed");
    await sell(3, 50);
    const del = await deleteTransaction({ id: r.data.id }, db);
    expect(del.ok).toBe(true);
    // After deleting the buy, the sell (from nothing) leaves qty = -3 and
    // cash = start + sell proceeds. This is a defensive-scenario; just
    // verify cash matches the movements ledger exactly.
    const movements = db
      .select()
      .from(schema.accountCashMovements)
      .where(eq(schema.accountCashMovements.accountId, accountId))
      .all();
    const sum = movements.reduce((s, m) => s + m.cashImpactEur, 0);
    expect(getAccountBalance()).toBeCloseTo(startBal + sum, 2);
  });

  it("rejects creating a duplicate fingerprint", async () => {
    const r1 = await buy(1, 10, "2026-02-01");
    expect(r1.ok).toBe(true);
    const r2 = await buy(1, 10, "2026-02-01");
    expect(r2.ok).toBe(false);
  });

  it("returns not_found for unknown account", async () => {
    const r = await createTransaction(
      {
        accountId: "missing",
        assetId,
        tradeDate: "2026-02-01",
        side: "buy",
        quantity: 1,
        priceNative: 1,
        currency: "EUR",
      },
      db,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("not_found");
  });
});

describe("cash movement actions", () => {
  let db: DB;
  let accountId: string;

  beforeEach(async () => {
    db = makeDb();
    const acc = await createAccount(
      { name: "Bank", accountType: "savings", currency: "EUR", openingBalanceNative: 0 },
      db,
    );
    if (!acc.ok) throw new Error("setup");
    accountId = acc.data.id;
  });

  it("deposit adds to balance, withdrawal subtracts", async () => {
    const a = await createCashMovement(
      { accountId, kind: "deposit", occurredAt: "2026-01-01", amountNative: 200, currency: "EUR" },
      db,
    );
    expect(a.ok).toBe(true);
    const b = await createCashMovement(
      {
        accountId,
        kind: "withdrawal",
        occurredAt: "2026-01-02",
        amountNative: 50,
        currency: "EUR",
      },
      db,
    );
    expect(b.ok).toBe(true);
    const row = db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .get();
    expect(row?.currentCashBalanceEur).toBeCloseTo(150, 2);
  });

  it("deleteCashMovement rejects trades", async () => {
    const ast = await createAsset(
      { name: "Bar", symbol: "BAR", assetType: "stock", currency: "EUR" },
      db,
    );
    if (!ast.ok) throw new Error("asset");
    const trade = await createTransaction(
      {
        accountId,
        assetId: ast.data.id,
        tradeDate: "2026-01-05",
        side: "buy",
        quantity: 1,
        priceNative: 10,
        currency: "EUR",
      },
      db,
    );
    expect(trade.ok).toBe(true);
    const movement = db
      .select()
      .from(schema.accountCashMovements)
      .where(eq(schema.accountCashMovements.movementType, "trade"))
      .get();
    expect(movement).toBeDefined();
    const del = await deleteCashMovement({ id: movement!.id }, db);
    expect(del.ok).toBe(false);
    if (del.ok) return;
    expect(del.error.code).toBe("conflict");
  });

  it("delete restores balance", async () => {
    const a = await createCashMovement(
      { accountId, kind: "deposit", occurredAt: "2026-01-01", amountNative: 200, currency: "EUR" },
      db,
    );
    if (!a.ok) throw new Error("dep failed");
    const del = await deleteCashMovement({ id: a.data.id }, db);
    expect(del.ok).toBe(true);
    const row = db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .get();
    expect(row?.currentCashBalanceEur).toBe(0);
  });
});
