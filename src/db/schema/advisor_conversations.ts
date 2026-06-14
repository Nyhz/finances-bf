import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";

/**
 * A persisted advisor chat thread, so a conversation started yesterday can be
 * continued today. The UI shows active threads as tabs; "Terminar" deletes the
 * thread and its messages. (The AI's long-term memory does NOT depend on this
 * table — it lives in the filesystem transcripts that compact weekly.)
 */
export const advisorConversations = sqliteTable(
  "advisor_conversations",
  {
    id: idCol(),
    /** Auto-derived from the first message; the Commander can rename it. Null until the first exchange. */
    title: text("title"),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => ({
    updatedAtIdx: index("advisor_conversations_updated_at_idx").on(t.updatedAt),
  }),
);

export type AdvisorConversation = typeof advisorConversations.$inferSelect;
export type NewAdvisorConversation = typeof advisorConversations.$inferInsert;
