import { marketEur } from "../../../lib/money-types";
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
      { country: "IE", type: "broker-securities", valueEur: marketEur(60_000), hasUnvalued: false, hasStale: false },
      { country: "ES", type: "broker-securities", valueEur: marketEur(10_000), hasUnvalued: false, hasStale: false },
      { country: "NL", type: "crypto", valueEur: marketEur(30_000), hasUnvalued: false, hasStale: false },
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
        m720: { blocks: [{ country: "IE", type: "broker-securities", valueEur: marketEur(60_000), hasUnvalued: false, hasStale: false, status: "new" }] },
      }),
    }).run();

    const blocks: Model720Block[] = [
      { country: "IE", type: "broker-securities", valueEur: marketEur(85_000), hasUnvalued: false, hasStale: false },
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
        m720: { blocks: [{ country: "IE", type: "broker-securities", valueEur: marketEur(60_000), hasUnvalued: false, hasStale: false, status: "new" }] },
      }),
    }).run();

    const res = computeInformationalModelsStatus(db, 2025, []);
    const ie = res.m720.blocks.find((b) => b.country === "IE");
    expect(ie?.status).toBe("full_exit");
  });

  // Audit fix 1: art. 42 bis/ter sets the €50k first-declaration threshold on
  // the JOINT value of each asset category, not per (country, type) block.
  it("flags ALL blocks of a category as new when their joint value crosses €50k", () => {
    const db = makeDb();
    const blocks: Model720Block[] = [
      { country: "IE", type: "broker-securities", valueEur: marketEur(30_000), hasUnvalued: false, hasStale: false },
      { country: "DE", type: "broker-securities", valueEur: marketEur(30_000), hasUnvalued: false, hasStale: false },
      // Different category at €30k — must NOT be pooled with securities.
      { country: "NL", type: "bank-accounts", valueEur: marketEur(30_000), hasUnvalued: false, hasStale: false },
    ];
    const res = computeInformationalModelsStatus(db, 2025, blocks);
    expect(res.m720.blocks.find((b) => b.country === "IE")?.status).toBe("new");
    expect(res.m720.blocks.find((b) => b.country === "DE")?.status).toBe("new");
    expect(res.m720.blocks.find((b) => b.country === "NL")?.status).toBe("ok");
  });

  it("does not pool crypto with securities for the joint threshold", () => {
    const db = makeDb();
    const blocks: Model720Block[] = [
      { country: "IE", type: "broker-securities", valueEur: marketEur(30_000), hasUnvalued: false, hasStale: false },
      { country: "MT", type: "crypto", valueEur: marketEur(30_000), hasUnvalued: false, hasStale: false },
    ];
    const res = computeInformationalModelsStatus(db, 2025, blocks);
    expect(res.m720.blocks.find((b) => b.country === "IE")?.status).toBe("ok");
    expect(res.m721.blocks.find((b) => b.country === "MT")?.status).toBe("ok");
  });

  // Audit fix 2: a prior year sealed below threshold (status "ok") was never
  // actually filed — it must not count as a declaration.
  it("treats a sub-threshold prior year as undeclared: first crossing is 'new'", () => {
    const db = makeDb();
    db.insert(taxYearSnapshots).values({
      id: ulid(), year: 2024,
      sealedAt: Date.UTC(2025, 0, 1),
      payloadJson: JSON.stringify({
        m720: { blocks: [{ country: "IE", type: "broker-securities", valueEur: marketEur(45_000), hasUnvalued: false, hasStale: false, status: "ok", lastDeclaredEur: null, declared: false }] },
      }),
    }).run();

    const blocks: Model720Block[] = [
      { country: "IE", type: "broker-securities", valueEur: marketEur(55_000), hasUnvalued: false, hasStale: false },
    ];
    const res = computeInformationalModelsStatus(db, 2025, blocks);
    const ie = res.m720.blocks.find((b) => b.country === "IE");
    expect(ie?.status).toBe("new");
    expect(ie?.lastDeclaredEur).toBeNull();
  });

  it("does not emit full_exit for a sub-threshold prior block that disappears", () => {
    const db = makeDb();
    db.insert(taxYearSnapshots).values({
      id: ulid(), year: 2024,
      sealedAt: Date.UTC(2025, 0, 1),
      payloadJson: JSON.stringify({
        m720: { blocks: [{ country: "IE", type: "broker-securities", valueEur: marketEur(45_000), hasUnvalued: false, hasStale: false, status: "ok", lastDeclaredEur: null, declared: false }] },
      }),
    }).run();

    const res = computeInformationalModelsStatus(db, 2025, []);
    expect(res.m720.blocks).toHaveLength(0);
  });

  it("does not re-emit full_exit for an already-declared extinction", () => {
    const db = makeDb();
    db.insert(taxYearSnapshots).values({
      id: ulid(), year: 2024,
      sealedAt: Date.UTC(2025, 0, 1),
      payloadJson: JSON.stringify({
        m720: { blocks: [{ country: "IE", type: "broker-securities", valueEur: marketEur(0), hasUnvalued: false, hasStale: false, status: "full_exit", lastDeclaredEur: 60_000, declared: true }] },
      }),
    }).run();

    const res = computeInformationalModelsStatus(db, 2025, []);
    expect(res.m720.blocks).toHaveLength(0);
  });

  // Backward compatibility: sealed payloads written before `declared` and
  // `hasUnknownCountry` existed must still parse, with the status string as
  // the filing signal.
  it("parses old-shaped sealed blocks without the new optional fields", () => {
    const db = makeDb();
    db.insert(taxYearSnapshots).values({
      id: ulid(), year: 2024,
      sealedAt: Date.UTC(2025, 0, 1),
      payloadJson: JSON.stringify({
        m720: {
          blocks: [
            // old shape — no `declared`, no `hasUnknownCountry`
            { country: "IE", type: "broker-securities", valueEur: 60_000, hasUnvalued: false, hasStale: false, status: "new", lastDeclaredEur: null },
            { country: "FR", type: "bank-accounts", valueEur: 10_000, hasUnvalued: false, hasStale: false, status: "ok", lastDeclaredEur: null },
          ],
        },
      }),
    }).run();

    const blocks: Model720Block[] = [
      { country: "IE", type: "broker-securities", valueEur: marketEur(85_000), hasUnvalued: false, hasStale: false },
      { country: "FR", type: "bank-accounts", valueEur: marketEur(12_000), hasUnvalued: false, hasStale: false },
    ];
    const res = computeInformationalModelsStatus(db, 2025, blocks);
    // status "new" without a declared flag still counts as filed…
    const ie = res.m720.blocks.find((b) => b.country === "IE");
    expect(ie?.status).toBe("delta_20k");
    expect(ie?.lastDeclaredEur).toBe(60_000);
    // …and status "ok" without a declared flag still counts as not filed.
    const fr = res.m720.blocks.find((b) => b.country === "FR");
    expect(fr?.status).toBe("ok");
    expect(fr?.lastDeclaredEur).toBeNull();
  });
});
