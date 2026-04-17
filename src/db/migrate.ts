import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const dbUrl = process.env.DATABASE_URL ?? "data/finances.db";
const dbPath = resolve(process.cwd(), dbUrl);
const dbDir = dirname(dbPath);

if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });

sqlite.close();

console.log(`Migrations applied to ${dbPath}`);
