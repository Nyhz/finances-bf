import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";

/**
 * Allocation objectives ("World", "Crypto", "Oro", "Small caps"…). An
 * objective hangs off the ASSET, not the account: the same exposure bought
 * through different brokers (VWCE at DEGIRO + an iShares developed-world
 * fund at MYINVESTOR) aggregates into one bucket. `targetPct` is the desired
 * share of the invested portfolio (0–100); the Objetivos page measures each
 * bucket's drift against it.
 */
export const objectives = sqliteTable(
  "objectives",
  {
    id: idCol(),
    name: text("name").notNull(),
    targetPct: real("target_pct").notNull(),
    /** Display position in the legend and the pie (drag & drop reorder).
     *  Ties (legacy rows) fall back to name order. */
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    /** Theme token ("--chart-1"…) — see src/lib/objective-colors.ts. Null
     *  falls back to a positional colour. */
    color: text("color"),
    notes: text("notes"),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => ({
    nameIdx: uniqueIndex("objectives_name_idx").on(t.name),
  }),
);

export type Objective = typeof objectives.$inferSelect;
export type NewObjective = typeof objectives.$inferInsert;
