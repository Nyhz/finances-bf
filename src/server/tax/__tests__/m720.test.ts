import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../../db/schema";
import type { DB } from "../../../db/client";
import { taxYearSnapshots } from "../../../db/schema";
import { computeInformationalModelsStatus, type Model720Block } from "../m720";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("computeInformationalModelsStatus", () => {
  it("flags a new 720 block when foreign securities cross €50k for the first time", () => {
    const db = makeDb();
    const blocks: Model720Block[] = [
      { country: "IE", type: "broker-securities", valueEur: 60_000 },
      { country: "ES", type: "broker-securities", valueEur: 10_000 },
      { country: "NL", type: "crypto", valueEur: 30_000 },
    ];
    const res = computeInformationalModelsStatus(db, 2025, blocks);
    const ie = res.m720.blocks.find((b) => b.country === "IE");
    expect(ie?.status).toBe("new");
    const es = res.m720.blocks.find((b) => b.country === "ES");
    expect(es).toBeUndefined();
    const nl = res.m721.blocks.find((b) => b.country === "NL");
    expect(nl?.status).toBe("ok");
  });

  it("flags delta_20k when a previously-declared block grows by more than €20k", () => {
    const db = makeDb();
    db.insert(taxYearSnapshots).values({
      id: ulid(), year: 2024,
      sealedAt: Date.UTC(2025, 0, 1),
      payloadJson: JSON.stringify({
        m720: { blocks: [{ country: "IE", type: "broker-securities", valueEur: 60_000, status: "new" }] },
      }),
    }).run();

    const blocks: Model720Block[] = [
      { country: "IE", type: "broker-securities", valueEur: 85_000 },
    ];
    const res = computeInformationalModelsStatus(db, 2025, blocks);
    const ie = res.m720.blocks.find((b) => b.country === "IE");
    expect(ie?.status).toBe("delta_20k");
    expect(ie?.lastDeclaredEur).toBe(60_000);
  });

  it("flags full_exit when a previously-declared block drops to zero", () => {
    const db = makeDb();
    db.insert(taxYearSnapshots).values({
      id: ulid(), year: 2024,
      sealedAt: Date.UTC(2025, 0, 1),
      payloadJson: JSON.stringify({
        m720: { blocks: [{ country: "IE", type: "broker-securities", valueEur: 60_000, status: "new" }] },
      }),
    }).run();

    const res = computeInformationalModelsStatus(db, 2025, []);
    const ie = res.m720.blocks.find((b) => b.country === "IE");
    expect(ie?.status).toBe("full_exit");
  });
});
