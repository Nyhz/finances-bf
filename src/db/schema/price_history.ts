import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol } from "./_shared";

export const priceHistory = sqliteTable(
  "price_history",
  {
    id: idCol(),
    symbol: text("symbol").notNull(),
    pricedAt: integer("priced_at", { mode: "number" }).notNull(),
    pricedDateUtc: text("priced_date_utc").notNull(), // ISO yyyy-MM-dd
    price: real("price").notNull(),
    source: text("source").notNull(),
    createdAt: createdAtCol(),
  },
  (t) => ({
    symbolDateIdx: uniqueIndex("price_history_symbol_date_idx").on(t.symbol, t.pricedDateUtc),
  }),
);

export type PriceHistoryRow = typeof priceHistory.$inferSelect;
export type NewPriceHistoryRow = typeof priceHistory.$inferInsert;
