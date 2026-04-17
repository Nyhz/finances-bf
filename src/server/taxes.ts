import { db as defaultDb, type DB } from "../db/client";
import { assetTransactions } from "../db/schema";

export async function getTaxYears(db: DB = defaultDb): Promise<number[]> {
  const rows = await db
    .select({ tradedAt: assetTransactions.tradedAt })
    .from(assetTransactions)
    .all();
  const years = new Set<number>();
  for (const row of rows) {
    years.add(new Date(row.tradedAt).getUTCFullYear());
  }
  return [...years].sort((a, b) => b - a);
}

export type RealizedGain = {
  assetId: string;
  closedAt: number;
  quantity: number;
  proceedsEur: number;
  costBasisEur: number;
  gainEur: number;
};

export type RealizedGainsResult = {
  gains: RealizedGain[];
  totalRealizedEur: number;
};

// Stub — FIFO engine ships in a later mission. The signature is real so the
// /taxes page can render an empty state without type gymnastics.
export async function getRealizedGains(
  year: number,
): Promise<RealizedGainsResult> {
  void year;
  return { gains: [], totalRealizedEur: 0 };
}
