import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const dbUrl = process.env.DATABASE_URL ?? process.env.DB_PATH ?? "data/finances.db";
const dbPath = resolve(/* turbopackIgnore: true */ process.cwd(), dbUrl);
const dbDir = dirname(dbPath);

if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

export const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export type DB = typeof db;

/** Drizzle better-sqlite3 transaction handle — the parameter every tx-scoped
 *  recompute/action helper takes. Canonical home so callers stop re-deriving
 *  it with the same Parameters<Parameters<…>> gymnastics. */
export type Tx = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/** Accepted by helpers callable both from a top-level handle and inside a tx. */
export type DbOrTx = DB | Tx;

export function getDbPath() {
  return dbPath;
}
