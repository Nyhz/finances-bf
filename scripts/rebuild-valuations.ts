import { db } from "../src/db/client";
import { assets } from "../src/db/schema";
import { rebuildValuationsForAsset } from "../src/server/valuations";

async function main() {
  const allAssets = db.select().from(assets).all();
  console.log(`rebuilding valuations for ${allAssets.length} assets…`);
  db.transaction((tx) => {
    for (const asset of allAssets) {
      rebuildValuationsForAsset(tx, asset.id);
      console.log(`  ${asset.name} [${asset.symbol ?? asset.providerSymbol ?? "?"}] done`);
    }
  });
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
