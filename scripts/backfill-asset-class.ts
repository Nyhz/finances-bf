import { db } from "../src/db/client";
import { assets } from "../src/db/schema";
import { eq, isNull } from "drizzle-orm";
import { inferAssetClassTax } from "../src/server/tax/classification";

async function main() {
  const rows = db.select().from(assets).where(isNull(assets.assetClassTax)).all();
  let updated = 0;
  for (const row of rows) {
    const cls = inferAssetClassTax({
      assetType: row.assetType,
      subtype: row.subtype,
      name: row.name,
      ticker: row.ticker,
      isin: row.isin,
    });
    db.update(assets).set({ assetClassTax: cls }).where(eq(assets.id, row.id)).run();
    updated++;
    console.log(`  ${row.isin ?? row.id} (${row.name}) → ${cls}`);
  }
  console.log(`\nBackfilled asset_class_tax for ${updated} assets.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
