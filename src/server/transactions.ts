import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { assetTransactions, type AssetTransaction } from "../db/schema";
import { decodeCursor, encodeCursor } from "../lib/pagination";

export type ListTransactionsArgs = {
  cursor?: string;
  limit?: number;
  accountId?: string;
  assetId?: string;
  type?: string;
};

export type ListTransactionsResult = {
  items: AssetTransaction[];
  nextCursor: string | null;
};

const DEFAULT_LIMIT = 50;

export async function listTransactions(
  args: ListTransactionsArgs = {},
  db: DB = defaultDb,
): Promise<ListTransactionsResult> {
  const limit = args.limit ?? DEFAULT_LIMIT;
  if (limit <= 0) throw new Error("listTransactions: limit must be > 0");

  const filters: SQL[] = [];
  if (args.accountId) filters.push(eq(assetTransactions.accountId, args.accountId));
  if (args.assetId) filters.push(eq(assetTransactions.assetId, args.assetId));
  if (args.type) filters.push(eq(assetTransactions.transactionType, args.type));

  if (args.cursor) {
    const cur = decodeCursor(args.cursor);
    const sortKey = typeof cur.sortKey === "number" ? cur.sortKey : Number(cur.sortKey);
    filters.push(
      or(
        lt(assetTransactions.tradedAt, sortKey),
        and(eq(assetTransactions.tradedAt, sortKey), lt(assetTransactions.id, cur.id)),
      ) as SQL,
    );
  }

  const where = filters.length ? and(...filters) : undefined;
  const rows = await db
    .select()
    .from(assetTransactions)
    .where(where)
    .orderBy(desc(assetTransactions.tradedAt), desc(assetTransactions.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ id: last.id, sortKey: last.tradedAt }) : null;
  return { items, nextCursor };
}

export async function getTransaction(
  id: string,
  db: DB = defaultDb,
): Promise<AssetTransaction | null> {
  const row = await db
    .select()
    .from(assetTransactions)
    .where(eq(assetTransactions.id, id))
    .get();
  return row ?? null;
}

export async function listRecentTransactions(
  limit = 10,
  db: DB = defaultDb,
): Promise<AssetTransaction[]> {
  return db
    .select()
    .from(assetTransactions)
    .orderBy(desc(assetTransactions.tradedAt), desc(assetTransactions.id))
    .limit(limit)
    .all();
}
