import { desc, eq } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { advisorRuns, discoverCandidates, type DiscoverCandidate } from "../db/schema";

// Confirmed opportunities from the latest Discover run (already verified, only
// `confirmed` rows are stored), newest first.
export async function listDiscoverCandidates(db: DB = defaultDb): Promise<DiscoverCandidate[]> {
  return db
    .select()
    .from(discoverCandidates)
    .orderBy(desc(discoverCandidates.discoveredAt))
    .all();
}

export type DiscoverRunInfo = {
  startedAt: number;
  status: string;
  summary: string | null;
} | null;

// Last Discover run (from advisor_runs, kind="discover") for the "última
// actualización" stamp. No cost is surfaced — telemetry only.
export async function getLastDiscoverRun(db: DB = defaultDb): Promise<DiscoverRunInfo> {
  const row = db
    .select()
    .from(advisorRuns)
    .where(eq(advisorRuns.kind, "discover"))
    .orderBy(desc(advisorRuns.startedAt))
    .get();
  return row ? { startedAt: row.startedAt, status: row.status, summary: row.summary } : null;
}
