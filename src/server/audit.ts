import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { auditEvents, type AuditEvent } from "../db/schema";
import { decodeCursor, encodeCursor } from "../lib/pagination";

export type ListAuditEventsArgs = {
  cursor?: string;
  limit?: number;
  entityType?: string;
  entityId?: string;
};

export type ListAuditEventsResult = {
  items: AuditEvent[];
  nextCursor: string | null;
};

const DEFAULT_LIMIT = 50;

export async function listAuditEvents(
  args: ListAuditEventsArgs = {},
  db: DB = defaultDb,
): Promise<ListAuditEventsResult> {
  const limit = args.limit ?? DEFAULT_LIMIT;
  if (limit <= 0) throw new Error("listAuditEvents: limit must be > 0");

  const filters: SQL[] = [];
  if (args.entityType) filters.push(eq(auditEvents.entityType, args.entityType));
  if (args.entityId) filters.push(eq(auditEvents.entityId, args.entityId));

  if (args.cursor) {
    const cur = decodeCursor(args.cursor);
    const sortKey = typeof cur.sortKey === "number" ? cur.sortKey : Number(cur.sortKey);
    filters.push(
      or(
        lt(auditEvents.createdAt, sortKey),
        and(eq(auditEvents.createdAt, sortKey), lt(auditEvents.id, cur.id)),
      ) as SQL,
    );
  }

  const where = filters.length ? and(...filters) : undefined;
  const rows = await db
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ id: last.id, sortKey: last.createdAt }) : null;
  return { items, nextCursor };
}
