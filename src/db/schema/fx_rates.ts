import { real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol } from "./_shared";

export const fxRates = sqliteTable(
  "fx_rates",
  {
    id: idCol(),
    currency: text("currency").notNull(),
    date: text("date").notNull(), // ISO yyyy-MM-dd
    rateToEur: real("rate_to_eur").notNull(),
    source: text("source").notNull().default("yahoo_fx"),
    createdAt: createdAtCol(),
  },
  (t) => ({
    currencyDateIdx: uniqueIndex("fx_rates_currency_date_idx").on(t.currency, t.date),
  }),
);

export type FxRate = typeof fxRates.$inferSelect;
export type NewFxRate = typeof fxRates.$inferInsert;
