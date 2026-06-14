import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { advisorConversations } from "./advisor_conversations";
import { createdAtCol, idCol } from "./_shared";

/** One turn in a persisted advisor thread. Deleted with its conversation (cascade). */
export const advisorMessages = sqliteTable(
  "advisor_messages",
  {
    id: idCol(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => advisorConversations.id, { onDelete: "cascade" }),
    /** user | assistant */
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: createdAtCol(),
  },
  (t) => ({
    conversationIdx: index("advisor_messages_conversation_idx").on(t.conversationId, t.createdAt),
  }),
);

export type AdvisorMessage = typeof advisorMessages.$inferSelect;
export type NewAdvisorMessage = typeof advisorMessages.$inferInsert;
