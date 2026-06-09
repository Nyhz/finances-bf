#!/usr/bin/env node
/**
 * Migration data-guard (audit R4 / test R-13).
 *
 * Fails when a migration under drizzle/ mutates user-entered data —
 * UPDATE/DELETE against the tables that hold tax inputs. Schema changes
 * (CREATE/ALTER ADD COLUMN) pass freely; rewriting history must be a
 * deliberate, allow-listed decision with a written rollback note.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

// Tables holding user-entered tax inputs. Derived tables (tax_lots,
// asset_valuations, …) are rebuildable and exempt.
const PROTECTED_TABLES = [
  "asset_transactions",
  "account_cash_movements",
  "accounts",
];

// Shipped before the guard existed (audit findings R4). Anything new must
// be added here explicitly, with a rollback note in the commit message.
const ALLOWLIST = new Set([
  "0002_cash_bearing_account_types.sql",
  "0003_prune_account_types.sql",
]);

const tableAlt = PROTECTED_TABLES.join("|");
const MUTATION_RE = new RegExp(
  String.raw`\b(?:UPDATE\s+\x60?(${tableAlt})\x60?|DELETE\s+FROM\s+\x60?(${tableAlt})\x60?)\b`,
  "gi",
);

function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Guard 2: journal timestamps must be strictly increasing. Drizzle's migrator
// skips every migration whose `when` is ≤ the newest applied `created_at`, so
// a single hand-edited future timestamp silently disables ALL later
// migrations ("Migrations applied" prints while nothing happens — this
// actually occurred: 0002/0003 were stamped 2027-04-27 and 0004-0008 were
// silently skipped until repaired on 2026-06-09).
import { join as joinPath } from "node:path";
const journal = JSON.parse(
  readFileSync(joinPath(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
);
let prevWhen = 0;
const journalViolations = [];
for (const entry of journal.entries) {
  if (entry.when <= prevWhen) {
    journalViolations.push(
      `  ${entry.tag}: when=${entry.when} is not greater than the previous entry (${prevWhen})`,
    );
  }
  if (entry.when > Date.now() + 24 * 60 * 60 * 1000) {
    journalViolations.push(`  ${entry.tag}: when=${entry.when} is in the future`);
  }
  prevWhen = entry.when;
}
if (journalViolations.length > 0) {
  console.error(
    "check-migrations: drizzle/meta/_journal.json timestamps are broken — the migrator will silently skip migrations.\n",
  );
  for (const v of journalViolations) console.error(v);
  process.exit(1);
}

const violations = [];
for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
  if (ALLOWLIST.has(file)) continue;
  const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  for (const match of sql.matchAll(MUTATION_RE)) {
    violations.push({ file, statement: match[0], table: match[1] ?? match[2] });
  }
}

if (violations.length > 0) {
  console.error("check-migrations: migrations must not rewrite user-entered data.\n");
  for (const v of violations) {
    console.error(`  ${v.file}: "${v.statement}" touches protected table ${v.table}`);
  }
  console.error(
    "\nIf this mutation is truly intended: add the file to ALLOWLIST in scripts/check-migrations.mjs" +
      "\nand document the rollback path in the commit message.",
  );
  process.exit(1);
}

console.log("check-migrations: ok");
