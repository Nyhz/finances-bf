import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { toggleAssetWatchlist } from "../toggleAssetWatchlist";
import { createAlert } from "../createAlert";
import { deleteAlert } from "../deleteAlert";
import { acknowledgeAlertEvent } from "../acknowledgeAlertEvent";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedAsset(db: DB): string {
  const id = ulid();
  db.insert(schema.assets).values({ id, name: "Apple", assetType: "stock", symbol: "AAPL" }).run();
  return id;
}

describe("watchlist actions", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("toggles watchlist membership and writes an audit event", async () => {
    const id = seedAsset(db);
    const res = await toggleAssetWatchlist({ id, watchlisted: true }, db);
    expect(res.ok).toBe(true);

    const asset = db.select().from(schema.assets).where(eq(schema.assets.id, id)).get();
    expect(asset?.isWatchlisted).toBe(true);

    const audit = db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, id))
      .all();
    expect(audit.some((a) => a.action === "watchlist_add")).toBe(true);
  });

  it("removing from the watchlist deletes the asset's alerts and cached quote", async () => {
    const id = seedAsset(db);
    await toggleAssetWatchlist({ id, watchlisted: true }, db);
    const created = await createAlert({ assetId: id, kind: "price_below", threshold: 50 }, db);
    expect(created.ok).toBe(true);
    db.insert(schema.watchlistQuotes)
      .values({ id: ulid(), assetId: id, price: 60, currency: "USD", asOf: Date.now(), source: "yahoo" })
      .run();

    const off = await toggleAssetWatchlist({ id, watchlisted: false }, db);
    expect(off.ok).toBe(true);
    expect(db.select().from(schema.priceAlerts).all()).toHaveLength(0);
    expect(db.select().from(schema.watchlistQuotes).all()).toHaveLength(0);
  });

  it("rejects an alert with a non-positive threshold", async () => {
    const id = seedAsset(db);
    const res = await createAlert({ assetId: id, kind: "price_below", threshold: 0 }, db);
    expect(res.ok).toBe(false);
  });

  it("creates an alert armed by default", async () => {
    const id = seedAsset(db);
    const res = await createAlert(
      { assetId: id, kind: "price_above", threshold: 250, notifyTelegram: true },
      db,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.status).toBe("armed");
      expect(res.data.notifyTelegram).toBe(true);
    }
  });

  it("fires immediately when a new alert is already met by the cached price", async () => {
    const id = seedAsset(db);
    db.insert(schema.watchlistQuotes)
      .values({ id: ulid(), assetId: id, price: 92, currency: "EUR", asOf: Date.now(), source: "yahoo" })
      .run();

    // price 92 < threshold 100 → should trigger on creation, not wait for cron.
    const res = await createAlert({ assetId: id, kind: "price_below", threshold: 100 }, db);
    expect(res.ok).toBe(true);

    const alert = db.select().from(schema.priceAlerts).where(eq(schema.priceAlerts.assetId, id)).get();
    expect(alert?.status).toBe("triggered");
    const events = db.select().from(schema.alertEvents).all();
    expect(events).toHaveLength(1);
    expect(events[0].priceAtTrigger).toBe(92);
  });

  it("does not fire a new alert when the cached price is on the safe side", async () => {
    const id = seedAsset(db);
    db.insert(schema.watchlistQuotes)
      .values({ id: ulid(), assetId: id, price: 120, currency: "EUR", asOf: Date.now(), source: "yahoo" })
      .run();

    const res = await createAlert({ assetId: id, kind: "price_below", threshold: 100 }, db);
    expect(res.ok).toBe(true);
    const alert = db.select().from(schema.priceAlerts).where(eq(schema.priceAlerts.assetId, id)).get();
    expect(alert?.status).toBe("armed");
    expect(db.select().from(schema.alertEvents).all()).toHaveLength(0);
  });

  it("deleting an alert cascades its events; acknowledging stamps the event", async () => {
    const id = seedAsset(db);
    const created = await createAlert({ assetId: id, kind: "price_below", threshold: 100 }, db);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Hand-insert a fired event for this alert.
    const eventId = ulid();
    db.insert(schema.alertEvents)
      .values({
        id: eventId,
        alertId: created.data.id,
        assetId: id,
        kind: "price_below",
        threshold: 100,
        priceAtTrigger: 95,
        currency: "USD",
        triggeredAt: Date.now(),
      })
      .run();

    const ack = await acknowledgeAlertEvent({ id: eventId }, db);
    expect(ack.ok).toBe(true);
    const acked = db.select().from(schema.alertEvents).where(eq(schema.alertEvents.id, eventId)).get();
    expect(acked?.acknowledgedAt).not.toBeNull();

    // Deleting the alert removes its (now acknowledged) events too.
    const del = await deleteAlert({ id: created.data.id }, db);
    expect(del.ok).toBe(true);
    expect(db.select().from(schema.alertEvents).all()).toHaveLength(0);
  });
});
