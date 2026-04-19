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
