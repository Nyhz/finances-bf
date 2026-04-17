import { real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts";
import { createdAtCol, idCol } from "./_shared";

export const dailyBalances = sqliteTable(
  "daily_balances",
  {
    id: idCol(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    balanceDate: text("balance_date").notNull(), // ISO yyyy-MM-dd
    balanceEur: real("balance_eur").notNull(),
    createdAt: createdAtCol(),
  },
  (t) => ({
    accountDateIdx: uniqueIndex("daily_balances_account_date_idx").on(t.accountId, t.balanceDate),
  }),
);

export type DailyBalance = typeof dailyBalances.$inferSelect;
export type NewDailyBalance = typeof dailyBalances.$inferInsert;
