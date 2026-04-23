import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { assets, assetTransactions } from "../src/db/schema";
import { resolveFxRange, writeFxBars } from "../src/lib/fx-backfill";
import { rebuildValuationsForAsset } from "../src/server/valuations";
import { toIsoDate } from "../src/lib/fx";

async function main() {
  const ccyRows = db
    .select({
      ccy: assetTransactions.tradeCurrency,
      minAt: sql<number>`min(${assetTransactions.tradedAt})`,
    })
    .from(assetTransactions)
    .groupBy(assetTransactions.tradeCurrency)
    .all();
  const toIso = toIsoDate(new Date());

  // Phase 1: fetch everything in memory. If anything fails, abort.
  const fetched: Array<{ ccy: string; bars: Awaited<ReturnType<typeof resolveFxRange>>["bars"] }> = [];
  for (const r of ccyRows) {
    if (r.ccy === "EUR") continue;
    const fromIso = toIsoDate(new Date(r.minAt));
    console.log(`fetching fx ${r.ccy}: ${fromIso} → ${toIso}`);
    const res = await resolveFxRange(r.ccy, fromIso, toIso);
    console.log(`  source=${res.source} bars=${res.bars.length}`);
    fetched.push({ ccy: r.ccy, bars: res.bars });
  }

  // Phase 2: single tx — write FX, then rebuild valuations.
  const all = db.select().from(assets).all();
  console.log(`writing fx + rebuilding valuations for ${all.length} assets…`);
  db.transaction((tx) => {
    for (const { ccy, bars } of fetched) {
      const r = writeFxBars(tx, ccy, bars);
      console.log(`  fx ${ccy}: inserted=${r.inserted} skipped=${r.skipped}`);
    }
    for (const a of all) rebuildValuationsForAsset(tx, a.id);
  });
  console.log("done");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
