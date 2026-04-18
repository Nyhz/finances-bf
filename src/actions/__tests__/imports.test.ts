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
import { previewImport } from "../previewImport";
import { confirmImport } from "../confirmImport";
import { parseDegiroCsv } from "../../lib/imports/degiro";
import { ulid } from "ulid";

const CSV = `Date,Time,Product,ISIN,Venue,Quantity,Price,Currency,Local value,Value,Exchange rate,Transaction costs,Total,Order ID
02-01-2026,09:32,ASML HOLDING,NL0010273215,EAM,10,650.50,EUR,-6505.00,-6505.00,1,-2.00,-6507.00,ord-001
15-01-2026,10:00,ASML HOLDING,NL0010273215,EAM,-3,700.00,EUR,2100.00,2100.00,1,-1.50,2098.50,ord-002
15-03-2026,00:00,Dividend ASML HOLDING,NL0010273215,,,,EUR,,,1,,15.40,div-001
20-03-2026,00:00,flatex Deposit,,,,,EUR,,,1,,1000.00,dep-001
`;

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

async function setupAccount(db: DB, opening = 0) {
  const acc = await createAccount(
    {
      name: "DeGiro",
      accountType: "savings",
      currency: "EUR",
      openingBalanceNative: opening,
    },
    db,
  );
  if (!acc.ok) throw new Error("account setup");
  return acc.data.id;
}

describe("previewImport", () => {
  let db: DB;
  let accountId: string;

  beforeEach(async () => {
    db = makeDb();
    accountId = await setupAccount(db);
  });

  it("marks parser-matching fingerprints as duplicate", async () => {
    const parsed = parseDegiroCsv(CSV);
    // Pick the first trade fingerprint and seed it as an already-imported
    // asset_transaction row so preview can detect it.
    const firstTrade = parsed.rows.find((r) => r.kind === "trade");
    if (!firstTrade) throw new Error("no trade in fixture");

    // Create the ASML asset so this seed row references a real asset.
    const asset = await createAsset(
      {
        name: "ASML Holding",
        symbol: "ASML",
        isin: "NL0010273215",
        assetType: "stock",
        currency: "EUR",
      },
      db,
    );
    if (!asset.ok) throw new Error("asset setup");

    const now = Date.now();
    db.insert(schema.assetTransactions)
      .values({
        id: ulid(),
        accountId,
        assetId: asset.data.id,
        transactionType: "buy",
        tradedAt: Date.parse("2026-01-02T12:00:00Z"),
        quantity: 10,
        unitPrice: 650.5,
        tradeCurrency: "EUR",
        fxRateToEur: 1,
        tradeGrossAmount: 6505,
        tradeGrossAmountEur: 6505,
        cashImpactEur: -6507,
        feesAmount: 2,
        feesAmountEur: 2,
        netAmountEur: -6507,
        rowFingerprint: firstTrade.rowFingerprint,
        source: "seed",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Seed a dividend row fingerprint too.
    const firstDividend = parsed.rows.find(
      (r) => r.kind === "cash_movement" && r.movement === "dividend",
    );
    if (!firstDividend) throw new Error("no dividend in fixture");
    db.insert(schema.accountCashMovements)
      .values({
        id: ulid(),
        accountId,
        movementType: "dividend",
        occurredAt: Date.parse("2026-03-15T12:00:00Z"),
        nativeAmount: 15.4,
        currency: "EUR",
        fxRateToEur: 1,
        cashImpactEur: 15.4,
        rowFingerprint: firstDividend.rowFingerprint,
        source: "seed",
        affectsCashBalance: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const res = await previewImport(
      { source: "degiro", accountId, csvText: CSV },
      db,
    );
    if (!res.ok) throw new Error("preview failed");
    expect(res.data.rows.length).toBe(4);

    const byFp = new Map(res.data.rows.map((r) => [r.rowFingerprint, r]));
    expect(byFp.get(firstTrade.rowFingerprint)?.status).toBe("duplicate");
    expect(byFp.get(firstDividend.rowFingerprint)?.status).toBe("duplicate");

    // The sell row and deposit row should be 'new' or 'needs_asset_creation'
    // (sell: asset already exists via seed → 'new'; deposit is cash only).
    const sell = res.data.rows.find((r) => r.side === "sell");
    expect(sell?.status).toBe("new");
    const deposit = res.data.rows.find((r) => r.movement === "deposit");
    expect(deposit?.status).toBe("new");

    expect(res.data.counts.duplicate).toBe(2);
    expect(res.data.counts.total).toBe(4);
  });

  it("flags the first trade row as needs_asset_creation and subsequent rows of the same asset as new", async () => {
    const res = await previewImport(
      { source: "degiro", accountId, csvText: CSV },
      db,
    );
    if (!res.ok) throw new Error("preview failed");
    const trades = res.data.rows.filter((r) => r.kind === "trade");
    expect(trades[0].status).toBe("needs_asset_creation");
    for (const t of trades.slice(1)) expect(t.status).toBe("new");
  });
});

describe("confirmImport", () => {
  let db: DB;
  let accountId: string;

  beforeEach(async () => {
    db = makeDb();
    accountId = await setupAccount(db, 0);
  });

  it("inserts all rows, auto-creates the asset, recomputes position + balance", async () => {
    const res = await confirmImport(
      { source: "degiro", accountId, csvText: CSV },
      db,
    );
    if (!res.ok) throw new Error(`confirm failed: ${!res.ok && res.error.message}`);
    expect(res.data.insertedTrades).toBe(2);
    expect(res.data.insertedCashMovements).toBe(2); // div + deposit (trade-paired are separate)
    expect(res.data.createdAssets).toBe(1);
    expect(res.data.skippedDuplicates).toBe(0);

    // Asset auto-created by ISIN.
    const asset = db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.isin, "NL0010273215"))
      .get();
    expect(asset).toBeDefined();

    // Asset position: buy 10 @ 650.50 + 2 fees, sell 3 @ 700. qty = 7, avg = 650.7
    const pos = db
      .select()
      .from(schema.assetPositions)
      .where(eq(schema.assetPositions.assetId, asset!.id))
      .get();
    expect(pos?.quantity).toBeCloseTo(7, 6);
    expect(pos?.averageCostNative).toBeCloseTo(650.7, 2);

    // Cash balance: -6507 + 2098.5 + 15.4 + 1000 = -3393.1
    const acc = db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .get();
    expect(acc?.currentCashBalanceEur).toBeCloseTo(-3393.1, 2);

    // Audit event for the commit.
    const audit = db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityType, "import"))
      .all();
    expect(audit.length).toBe(1);
    expect(audit[0].action).toBe("commit");
  });

  it("skips duplicate rows and leaves the DB consistent", async () => {
    const first = await confirmImport(
      { source: "degiro", accountId, csvText: CSV },
      db,
    );
    expect(first.ok).toBe(true);
    const second = await confirmImport(
      { source: "degiro", accountId, csvText: CSV },
      db,
    );
    if (!second.ok) throw new Error("second confirm failed");
    expect(second.data.inserted).toBe(0);
    expect(second.data.skippedDuplicates).toBe(4);
  });

  it("rolls back on invalid input (missing account)", async () => {
    const res = await confirmImport(
      { source: "degiro", accountId: "missing", csvText: CSV },
      db,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("not_found");
    // Nothing inserted.
    const trades = db.select().from(schema.assetTransactions).all();
    expect(trades.length).toBe(0);
  });
});
