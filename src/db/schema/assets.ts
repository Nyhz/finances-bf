import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";

export const assets = sqliteTable(
  "assets",
  {
    id: idCol(),
    name: text("name").notNull(),
    assetType: text("asset_type").notNull(),
    subtype: text("subtype"),
    symbol: text("symbol"),
    ticker: text("ticker"),
    isin: text("isin"),
    exchange: text("exchange"),
    providerSymbol: text("provider_symbol"),
    currency: text("currency").notNull().default("EUR"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    notes: text("notes"),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => ({
    isinIdx: uniqueIndex("assets_isin_idx").on(t.isin),
  }),
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
