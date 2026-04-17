import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";

export const transactionImports = sqliteTable("transaction_imports", {
  id: idCol(),
  format: text("format").notNull(), // degiro | binance | cobas
  filename: text("filename"),
  status: text("status").notNull().default("pending"), // pending | completed | failed
  totalRows: integer("total_rows", { mode: "number" }).notNull().default(0),
  importedRows: integer("imported_rows", { mode: "number" }).notNull().default(0),
  duplicateRows: integer("duplicate_rows", { mode: "number" }).notNull().default(0),
  invalidRows: integer("invalid_rows", { mode: "number" }).notNull().default(0),
  notes: text("notes"),
  createdAt: createdAtCol(),
  updatedAt: updatedAtCol(),
});

export const transactionImportRows = sqliteTable(
  "transaction_import_rows",
  {
    id: idCol(),
    importId: text("import_id")
      .notNull()
      .references(() => transactionImports.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index", { mode: "number" }).notNull(),
    status: text("status").notNull(), // imported | duplicate | invalid | skipped
    rowFingerprint: text("row_fingerprint"),
    errorMessage: text("error_message"),
    assetTransactionId: text("asset_transaction_id"),
    cashMovementId: text("cash_movement_id"),
    rawPayload: text("raw_payload"),
    createdAt: createdAtCol(),
  },
  (t) => ({
    importIdx: index("transaction_import_rows_import_idx").on(t.importId),
  }),
);

export type TransactionImport = typeof transactionImports.$inferSelect;
export type NewTransactionImport = typeof transactionImports.$inferInsert;
export type TransactionImportRow = typeof transactionImportRows.$inferSelect;
export type NewTransactionImportRow = typeof transactionImportRows.$inferInsert;
