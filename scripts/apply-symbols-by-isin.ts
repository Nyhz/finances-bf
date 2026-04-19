import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { assets } from "../src/db/schema";

const BY_ISIN: Record<string, string> = {
  "IE00B5L8K969": "CEBL.DE",
  "IE00B4ND3602": "PPFB.DE",
  "US47215P1066": "JD",
  "US91324P1021": "UNH",
  "IE00BF4RFH31": "IUSN.DE",
  "IE00B3WJKG14": "QDVE.DE",
  "ES0126962069": "NXT.MC",
  "ES0109260531": "AMP.MC",
  "IE00BK5BQT80": "VWCE.DE",
};

for (const [isin, symbol] of Object.entries(BY_ISIN)) {
  const a = db.select().from(assets).where(eq(assets.isin, isin)).get();
  if (!a) { console.log(`skip ${isin} (no asset)`); continue; }
  db.update(assets).set({ providerSymbol: symbol, updatedAt: Date.now() }).where(eq(assets.id, a.id)).run();
  console.log(`${a.name} (${isin}) → ${symbol}`);
}
