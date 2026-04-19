import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { idCol } from "./_shared";

export const taxYearSnapshots = sqliteTable(
  "tax_year_snapshots",
  {
    id: idCol(),
    year: integer("year", { mode: "number" }).notNull(),
    sealedAt: integer("sealed_at", { mode: "number" }).notNull(),
    payloadJson: text("payload_json").notNull(),
    renderedPdfPath: text("rendered_pdf_path"),
    renderedCsvPaths: text("rendered_csv_paths"),
    notes: text("notes"),
  },
  (t) => ({
    yearIdx: uniqueIndex("tax_year_snapshots_year_idx").on(t.year),
  }),
);

export type TaxYearSnapshot = typeof taxYearSnapshots.$inferSelect;
export type NewTaxYearSnapshot = typeof taxYearSnapshots.$inferInsert;
