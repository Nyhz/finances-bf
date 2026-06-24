import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Avoid the network quote refresh; we're testing the asset find-or-create logic.
vi.mock("../refreshWatchlistQuote", () => ({
  refreshWatchlistQuote: vi.fn(async () => ({ ok: true, data: { refreshed: false } })),
}));

import { addSymbolToWatchlist } from "../addSymbolToWatchlist";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("addSymbolToWatchlist", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("creates a new watchlisted asset for an unknown ticker", async () => {
    const res = await addSymbolToWatchlist({ symbol: "NVDA", name: "NVIDIA" }, db);
    expect(res.ok).toBe(true);
    const asset = db.select().from(schema.assets).where(eq(schema.assets.providerSymbol, "NVDA")).get();
    expect(asset?.isWatchlisted).toBe(true);
    expect(asset?.assetType).toBe("stock");
  });

  it("flags an existing asset instead of duplicating it", async () => {
    const id = ulid();
    db.insert(schema.assets)
      .values({ id, name: "Apple", assetType: "stock", symbol: "AAPL", providerSymbol: "AAPL", isWatchlisted: false })
      .run();

    const res = await addSymbolToWatchlist({ symbol: "AAPL", name: "Apple" }, db);
    expect(res.ok).toBe(true);
    const rows = db.select().from(schema.assets).all();
    expect(rows).toHaveLength(1); // no duplicate
    expect(rows[0].isWatchlisted).toBe(true);
  });
});
