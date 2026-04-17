export type Cursor = {
  id: string;
  sortKey: string | number;
};

export function encodeCursor(row: Cursor): string {
  const json = JSON.stringify({ id: row.id, sortKey: row.sortKey });
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(encoded: string): Cursor {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as Cursor).id !== "string" ||
      (typeof (parsed as Cursor).sortKey !== "string" &&
        typeof (parsed as Cursor).sortKey !== "number")
    ) {
      throw new Error("invalid cursor payload");
    }
    return parsed as Cursor;
  } catch (err) {
    throw new Error(
      `decodeCursor: invalid cursor (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

export type PaginateArgs<T> = {
  items: ReadonlyArray<T>;
  limit: number;
  cursor?: string;
  cursorOf: (item: T) => Cursor;
  /** Comparison relative to a decoded cursor. Return true if item should appear after the cursor. */
  after?: (item: T, cursor: Cursor) => boolean;
};

export type PaginateResult<T> = {
  items: T[];
  nextCursor: string | null;
};

/**
 * Generic in-memory slicer. For Drizzle, compose the where/orderBy/limit at the query site
 * and pass the resulting rows here — or read `decodeCursor` directly and apply the predicate
 * in SQL. Keeping this helper generic avoids coupling to a specific query builder version.
 */
export function paginate<T>({
  items,
  limit,
  cursor,
  cursorOf,
  after,
}: PaginateArgs<T>): PaginateResult<T> {
  if (limit <= 0) {
    throw new Error("paginate: limit must be > 0");
  }
  let source: ReadonlyArray<T> = items;
  if (cursor) {
    const decoded = decodeCursor(cursor);
    const predicate =
      after ??
      ((item: T, c: Cursor) => {
        const k = cursorOf(item).sortKey;
        return k < c.sortKey || (k === c.sortKey && cursorOf(item).id < c.id);
      });
    source = items.filter((item) => predicate(item, decoded));
  }
  const page = source.slice(0, limit);
  const hasMore = source.length > limit;
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null,
  };
}
