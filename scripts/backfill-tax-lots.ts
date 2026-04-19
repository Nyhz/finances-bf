import { db } from "../src/db/client";
import { assetTransactions } from "../src/db/schema";
import { recomputeLotsForAsset } from "../src/server/tax/lots";

async function main() {
  const rows = db.select({ assetId: assetTransactions.assetId }).from(assetTransactions).all();
  const assetIds = [...new Set(rows.map((r) => r.assetId))];
  console.log(`Recomputing lots for ${assetIds.length} assets…`);
  db.transaction((tx) => {
    for (const id of assetIds) recomputeLotsForAsset(tx, id);
  });
  console.log("Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
