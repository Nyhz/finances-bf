import "server-only";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db as defaultDb, type DB } from "../../db/client";
import { advisorConversations, advisorMessages } from "../../db/schema";

/** A tab title derived from the first message: trimmed, single-line, ~60 chars. */
export function deriveTitle(firstMessage: string): string {
  const flat = firstMessage.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat || "Nueva conversación";
}

/**
 * Persist one chat exchange (user + assistant) into a conversation, bump its
 * activity timestamp, and set its title from the first message if still unset.
 * Mirrors appendTranscript's call site in the chat route. No-op if the
 * conversation row is missing (e.g. deleted mid-stream).
 */
export function persistChatExchange(
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
  when: Date,
  dbc: DB = defaultDb,
): void {
  const ts = when.getTime();
  dbc.transaction((tx) => {
    const conv = tx
      .select({ title: advisorConversations.title })
      .from(advisorConversations)
      .where(eq(advisorConversations.id, conversationId))
      .get();
    if (!conv) return;

    tx.insert(advisorMessages)
      .values([
        { id: ulid(), conversationId, role: "user", content: userMessage, createdAt: ts },
        { id: ulid(), conversationId, role: "assistant", content: assistantMessage, createdAt: ts + 1 },
      ])
      .run();

    tx.update(advisorConversations)
      .set({
        updatedAt: ts,
        ...(conv.title ? {} : { title: deriveTitle(userMessage) }),
      })
      .where(eq(advisorConversations.id, conversationId))
      .run();
  });
}
