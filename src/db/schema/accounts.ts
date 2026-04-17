import { real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";

export const accounts = sqliteTable("accounts", {
  id: idCol(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("EUR"),
  accountType: text("account_type").notNull(),
  openingBalanceEur: real("opening_balance_eur").notNull().default(0),
  currentCashBalanceEur: real("current_cash_balance_eur").notNull().default(0),
  createdAt: createdAtCol(),
  updatedAt: updatedAtCol(),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
