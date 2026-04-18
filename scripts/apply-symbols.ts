import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { assets } from "../src/db/schema";

const MAPPING: Record<string, string> = {
  "01KPEVR1JAYFDB4PGT5P1M8K34": "CEBL.DE",
  "01KPEVR1JP56V9FNHCFGK6JSQ8": "PPFB.DE",
  "01KPEVR1JV8YEG558XYCY5A8PF": "JD",
  "01KPEVR1K3QPT8GA50PY2PMN8C": "UNH",
  "01KPEVR1K6Z62R1318YZ9NATY2": "IUSN.DE",
  "01KPEVR1K9WP8K98B3YF8EHRNW": "QDVE.DE",
  "01KPEVR1KD602BACDSCAN1C159": "NXT.MC",
  "01KPEVR1KG3TPJDJZF4N7W6778": "AMP.MC",
  "01KPEVR1KN6SZ231210K26RMBD": "VWCE.DE",
};

for (const [id, symbol] of Object.entries(MAPPING)) {
  db.update(assets)
    .set({ providerSymbol: symbol, updatedAt: Date.now() })
    .where(eq(assets.id, id))
    .run();
  console.log(`${id} → ${symbol}`);
}
