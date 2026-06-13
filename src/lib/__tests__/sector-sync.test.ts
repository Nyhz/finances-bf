import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import {
  syncSectorWeightings,
  type SectorClient,
} from "../sector-sync";
import type { SectorWeight } from "../pricing";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedAsset(
  db: DB,
  name: string,
  assetType: string,
  symbol: string,
  opts: { isActive?: boolean; subtype?: string } = {},
): string {
  const id = ulid();
  db.insert(schema.assets)
    .values({
      id,
      name,
      assetType,
      providerSymbol: symbol,
      isActive: opts.isActive ?? true,
      subtype: opts.subtype ?? null,
    })
    .run();
  return id;
}

function fakeClient(
  table: Record<string, SectorWeight[]>,
  stockSectors: Record<string, string | null> = {},
): SectorClient {
  return {
    fetchSectorWeightings: vi.fn(async (symbol: string) => {
      if (!(symbol in table)) throw new Error(`no stub for ${symbol}`);
      return table[symbol];
    }),
    fetchAssetSector: vi.fn(async (symbol: string) => {
      if (!(symbol in stockSectors)) throw new Error(`no stub for ${symbol}`);
      return stockSectors[symbol];
    }),
  };
}

function sectorsFor(db: DB, assetId: string) {
  return db
    .select()
    .from(schema.assetSectorWeightings)
    .where(eq(schema.assetSectorWeightings.assetId, assetId))
    .all();
}

const NOW = Date.UTC(2026, 5, 13, 8);
const DAY = 24 * 60 * 60 * 1000;

describe("syncSectorWeightings", () => {
  let db: DB;

  beforeEach(() => {
    db = makeDb();
  });

  it("returns an empty summary on a fresh DB", async () => {
    const summary = await syncSectorWeightings(db, fakeClient({}), NOW);
    expect(summary).toEqual({ refreshed: 0, skipped: 0, errors: [] });
  });

  it("stores the sector breakdown for an ETF", async () => {
    const id = seedAsset(db, "VWCE", "etf", "VWCE.DE");
    const client = fakeClient({
      "VWCE.DE": [
        { sector: "technology", weight: 0.29 },
        { sector: "financial_services", weight: 0.16 },
      ],
    });
    const summary = await syncSectorWeightings(db, client, NOW);
    expect(summary.refreshed).toBe(1);
    const rows = sectorsFor(db, id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sector).sort()).toEqual([
      "financial_services",
      "technology",
    ]);
    expect(rows.every((r) => r.fetchedAt === NOW && r.source === "yahoo")).toBe(
      true,
    );
  });

  it("classifies an individual stock as a single 100% sector", async () => {
    const id = seedAsset(db, "AMP", "stock", "AMP.MC");
    const client = fakeClient({}, { "AMP.MC": "technology" });
    const summary = await syncSectorWeightings(db, client, NOW);
    expect(summary.refreshed).toBe(1);
    expect(client.fetchAssetSector).toHaveBeenCalledWith("AMP.MC");
    expect(client.fetchSectorWeightings).not.toHaveBeenCalled();
    const rows = sectorsFor(db, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sector).toBe("technology");
    expect(rows[0]?.weight).toBe(1);
  });

  it("stores nothing for a stock Yahoo has no sector for", async () => {
    const id = seedAsset(db, "PPFB-as-stock", "stock", "PPFB.DE");
    const client = fakeClient({}, { "PPFB.DE": null });
    const summary = await syncSectorWeightings(db, client, NOW);
    expect(summary.refreshed).toBe(1);
    expect(sectorsFor(db, id)).toHaveLength(0);
  });

  it("ignores crypto and bonds entirely", async () => {
    seedAsset(db, "BTC", "crypto", "bitcoin");
    seedAsset(db, "BOND", "bond", "BND");
    const client = fakeClient({});
    const summary = await syncSectorWeightings(db, client, NOW);
    expect(summary.refreshed).toBe(0);
    expect(client.fetchSectorWeightings).not.toHaveBeenCalled();
    expect(client.fetchAssetSector).not.toHaveBeenCalled();
  });

  it("skips commodity ETPs without calling Yahoo", async () => {
    const id = seedAsset(db, "Gold", "etf", "PPFB.DE", {
      subtype: "commodity",
    });
    const client = fakeClient({ "PPFB.DE": [] });
    const summary = await syncSectorWeightings(db, client, NOW);
    expect(summary.refreshed).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(client.fetchSectorWeightings).not.toHaveBeenCalled();
    expect(sectorsFor(db, id)).toHaveLength(0);
  });

  it("skips a fund whose data is still fresh, refetches once stale", async () => {
    const id = seedAsset(db, "IS3N", "etf", "IS3N.DE");
    const client = fakeClient({
      "IS3N.DE": [{ sector: "technology", weight: 0.42 }],
    });
    await syncSectorWeightings(db, client, NOW);
    expect(client.fetchSectorWeightings).toHaveBeenCalledTimes(1);

    // 1 day later: still within the 7-day freshness window → skip.
    const fresh = await syncSectorWeightings(db, client, NOW + DAY);
    expect(fresh.skipped).toBe(1);
    expect(fresh.refreshed).toBe(0);
    expect(client.fetchSectorWeightings).toHaveBeenCalledTimes(1);

    // 8 days later: stale → refetch.
    const stale = await syncSectorWeightings(db, client, NOW + 8 * DAY);
    expect(stale.refreshed).toBe(1);
    expect(client.fetchSectorWeightings).toHaveBeenCalledTimes(2);
    expect(sectorsFor(db, id)[0]?.fetchedAt).toBe(NOW + 8 * DAY);
  });

  it("replaces the previous snapshot, dropping sectors that fell out", async () => {
    const id = seedAsset(db, "VWCE", "etf", "VWCE.DE");
    let payload: SectorWeight[] = [
      { sector: "technology", weight: 0.3 },
      { sector: "energy", weight: 0.05 },
    ];
    const client: SectorClient = {
      fetchSectorWeightings: vi.fn(async () => payload),
      fetchAssetSector: vi.fn(async () => null),
    };
    await syncSectorWeightings(db, client, NOW);
    expect(sectorsFor(db, id)).toHaveLength(2);

    payload = [{ sector: "technology", weight: 0.35 }];
    await syncSectorWeightings(db, client, NOW + 8 * DAY);
    const rows = sectorsFor(db, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sector).toBe("technology");
    expect(rows[0]?.weight).toBeCloseTo(0.35);
  });

  it("records an error and continues when a fetch fails", async () => {
    seedAsset(db, "GOOD", "etf", "GOOD.DE");
    seedAsset(db, "BAD", "etf", "BAD.DE");
    const client = fakeClient({
      "GOOD.DE": [{ sector: "technology", weight: 0.5 }],
    });
    const summary = await syncSectorWeightings(db, client, NOW);
    expect(summary.refreshed).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.symbol).toBe("BAD.DE");
  });
});
