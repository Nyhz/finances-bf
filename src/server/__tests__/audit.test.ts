import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { listAuditEvents } from "../audit";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

type SeedInput = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  source?: string;
  createdAt: number;
};

function seed(db: DB, rows: SeedInput[]): void {
  for (const r of rows) {
    db.insert(schema.auditEvents)
      .values({
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        action: r.action,
        actorType: "user",
        source: r.source ?? "ui",
        createdAt: r.createdAt,
      })
      .run();
  }
}

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1); // 2026-01-01

describe("listAuditEvents — filters", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
    seed(db, [
      { id: "ae_1", entityType: "account", entityId: "acc_1", action: "create", createdAt: T0 },
      { id: "ae_2", entityType: "account", entityId: "acc_1", action: "update", createdAt: T0 + 1 * DAY },
      { id: "ae_3", entityType: "asset", entityId: "ast_1", action: "create", createdAt: T0 + 2 * DAY },
      { id: "ae_4", entityType: "asset_transaction", entityId: "tx_1", action: "create", createdAt: T0 + 3 * DAY },
      { id: "ae_5", entityType: "asset_transaction", entityId: "tx_2", action: "delete", createdAt: T0 + 5 * DAY },
      { id: "ae_6", entityType: "import", entityId: "imp_1", action: "commit", source: "import", createdAt: T0 + 7 * DAY },
    ]);
  });

  it("returns everything newest first with no filters", async () => {
    const res = await listAuditEvents({}, db);
    expect(res.items.map((r) => r.id)).toEqual([
      "ae_6",
      "ae_5",
      "ae_4",
      "ae_3",
      "ae_2",
      "ae_1",
    ]);
    expect(res.nextCursor).toBeNull();
  });

  it("filters by entityType only", async () => {
    const res = await listAuditEvents({ entityType: "asset_transaction" }, db);
    expect(res.items.map((r) => r.id)).toEqual(["ae_5", "ae_4"]);
  });

  it("filters by date range only", async () => {
    const res = await listAuditEvents(
      { dateFrom: T0 + 2 * DAY, dateTo: T0 + 5 * DAY },
      db,
    );
    expect(res.items.map((r) => r.id)).toEqual(["ae_5", "ae_4", "ae_3"]);
  });

  it("filters by entityType + action + date range combined", async () => {
    const res = await listAuditEvents(
      {
        entityType: "asset_transaction",
        action: "create",
        dateFrom: T0 + 3 * DAY,
        dateTo: T0 + 4 * DAY,
      },
      db,
    );
    expect(res.items.map((r) => r.id)).toEqual(["ae_4"]);
  });

  it("filters by entityId", async () => {
    const res = await listAuditEvents({ entityId: "acc_1" }, db);
    expect(res.items.map((r) => r.id)).toEqual(["ae_2", "ae_1"]);
  });

  it("filters by source", async () => {
    const res = await listAuditEvents({ source: "import" }, db);
    expect(res.items.map((r) => r.id)).toEqual(["ae_6"]);
  });

  it("returns empty page when filters match nothing", async () => {
    const res = await listAuditEvents({ entityType: "account", action: "delete" }, db);
    expect(res.items).toEqual([]);
    expect(res.nextCursor).toBeNull();
  });

  it("paginates via cursor round-trip", async () => {
    const first = await listAuditEvents({ limit: 2 }, db);
    expect(first.items.map((r) => r.id)).toEqual(["ae_6", "ae_5"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await listAuditEvents({ limit: 2, cursor: first.nextCursor! }, db);
    expect(second.items.map((r) => r.id)).toEqual(["ae_4", "ae_3"]);
    expect(second.nextCursor).not.toBeNull();

    const third = await listAuditEvents({ limit: 2, cursor: second.nextCursor! }, db);
    expect(third.items.map((r) => r.id)).toEqual(["ae_2", "ae_1"]);
    expect(third.nextCursor).toBeNull();
  });
});
