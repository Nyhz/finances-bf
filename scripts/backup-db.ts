/**
 * Safe SQLite backup. The live DB runs in WAL mode, so a plain `cp` of
 * data/finances.db can miss everything still sitting in finances.db-wal.
 * `VACUUM INTO` produces a consistent, checkpointed, single-file copy that
 * needs no -wal/-shm siblings and is safe while the app is running.
 *
 * Usage: pnpm db:backup [destination]
 * Default destination: data/backups/finances-backup.db (overwritten each run)
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

const source = process.env.DATABASE_URL ?? process.env.DB_PATH ?? "data/finances.db";
const dest = resolve(process.argv[2] ?? "data/backups/finances-backup.db");

if (!existsSync(source)) {
  console.error(`source database not found: ${source}`);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
// VACUUM INTO refuses to overwrite an existing file.
if (existsSync(dest)) unlinkSync(dest);

const db = new Database(source, { readonly: true });
try {
  db.prepare("VACUUM INTO ?").run(dest);
} finally {
  db.close();
}

const integrity = new Database(dest, { readonly: true });
try {
  const check = integrity.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  if (check.integrity_check !== "ok") {
    console.error(`backup integrity check FAILED: ${check.integrity_check}`);
    process.exit(1);
  }
} finally {
  integrity.close();
}

const bytes = statSync(dest).size;
console.log(`backup ok: ${dest} (${(bytes / 1024 / 1024).toFixed(2)} MB, integrity_check=ok)`);
