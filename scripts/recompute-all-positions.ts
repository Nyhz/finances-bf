import { db } from "../src/db/client";
import { assets } from "../src/db/schema";
import { recomputeAssetPosition } from "../src/server/recompute";

const rows = db.select({ id: assets.id }).from(assets).all();
console.log(`Recomputing positions for ${rows.length} assets…`);
db.transaction((tx) => {
  for (const r of rows) recomputeAssetPosition(tx, "", r.id);
});
console.log("Done.");
