import { sql } from "drizzle-orm";
import { db } from "@/src/db/client";
import { accounts } from "@/src/db/schema";

export async function GET() {
  const version = process.env.npm_package_version ?? "dev";
  const timestamp = new Date().toISOString();
  try {
    await db.select({ n: sql<number>`count(*)` }).from(accounts).get();
    return Response.json({ ok: true, version, timestamp, dbOk: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { ok: false, version, timestamp, dbOk: false, error: message },
      { status: 500 },
    );
  }
}
