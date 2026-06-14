import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { advisorConversations, advisorMessages } from "../db/schema";

export type ConversationTurn = { role: "user" | "assistant"; content: string };

export type ConversationWithMessages = {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ConversationTurn[];
};

/**
 * All persisted advisor threads, newest activity first, each with its messages.
 * Single-user, modest volume → loading everything is cheaper than per-tab fetches,
 * so switching tabs is instant client-side. Capped defensively.
 */
export function listConversations(dbc: DB = defaultDb, limit = 50): ConversationWithMessages[] {
  const convs = dbc
    .select()
    .from(advisorConversations)
    .orderBy(desc(advisorConversations.updatedAt))
    .limit(limit)
    .all();
  if (!convs.length) return [];

  const ids = convs.map((c) => c.id);
  const rows = dbc
    .select({
      conversationId: advisorMessages.conversationId,
      role: advisorMessages.role,
      content: advisorMessages.content,
    })
    .from(advisorMessages)
    .where(inArray(advisorMessages.conversationId, ids))
    .orderBy(asc(advisorMessages.createdAt))
    .all();

  const byConv = new Map<string, ConversationTurn[]>();
  for (const r of rows) {
    const list = byConv.get(r.conversationId) ?? [];
    list.push({ role: r.role === "assistant" ? "assistant" : "user", content: r.content });
    byConv.set(r.conversationId, list);
  }

  return convs.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messages: byConv.get(c.id) ?? [],
  }));
}

/** True if a conversation row exists — guards message persistence against a stale id. */
export function conversationExists(id: string, dbc: DB = defaultDb): boolean {
  return (
    dbc
      .select({ id: advisorConversations.id })
      .from(advisorConversations)
      .where(eq(advisorConversations.id, id))
      .get() != null
  );
}
