// Shared column helpers and unit conventions.
//
// Monetary columns are stored as REAL (double-precision float) in the unit
// named by the column suffix: `*Eur` → EUR; `*Native` / `*Amount` on rows that
// also carry a `currency` column → the native currency of that row. FX rates
// (`fxRateToEur`) are REAL and multiply native → EUR. Quantities are REAL to
// accommodate fractional crypto holdings. See SPEC §6.

import { integer, text } from "drizzle-orm/sqlite-core";

export const idCol = () => text("id").primaryKey().notNull();

export const createdAtCol = () =>
  integer("created_at", { mode: "number" })
    .notNull()
    .$defaultFn(() => Date.now());

export const updatedAtCol = () =>
  integer("updated_at", { mode: "number" })
    .notNull()
    .$defaultFn(() => Date.now());
