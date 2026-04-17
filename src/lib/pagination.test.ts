import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, paginate } from "./pagination";

type Row = { id: string; createdAt: string };

const rows: Row[] = [
  { id: "a", createdAt: "2026-04-10" },
  { id: "b", createdAt: "2026-04-09" },
  { id: "c", createdAt: "2026-04-08" },
  { id: "d", createdAt: "2026-04-07" },
  { id: "e", createdAt: "2026-04-06" },
];

const cursorOf = (r: Row) => ({ id: r.id, sortKey: r.createdAt });

describe("cursor encoding", () => {
  it("round-trips id and sortKey", () => {
    const c = { id: "abc", sortKey: "2026-04-17" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("round-trips numeric sortKey", () => {
    const c = { id: "z", sortKey: 42 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("rejects garbage", () => {
    expect(() => decodeCursor("not-a-valid-cursor!!!")).toThrow();
  });
});

describe("paginate", () => {
  it("returns the first page with a nextCursor when more remain", () => {
    const result = paginate({ items: rows, limit: 2, cursorOf });
    expect(result.items.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result.nextCursor).not.toBeNull();
  });

  it("walks pages using the nextCursor", () => {
    const first = paginate({ items: rows, limit: 2, cursorOf });
    const second = paginate({
      items: rows,
      limit: 2,
      cursorOf,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((r) => r.id)).toEqual(["c", "d"]);
    const third = paginate({
      items: rows,
      limit: 2,
      cursorOf,
      cursor: second.nextCursor ?? undefined,
    });
    expect(third.items.map((r) => r.id)).toEqual(["e"]);
    expect(third.nextCursor).toBeNull();
  });

  it("rejects non-positive limit", () => {
    expect(() => paginate({ items: rows, limit: 0, cursorOf })).toThrow();
  });
});
