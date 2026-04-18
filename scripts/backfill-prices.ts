import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
import { db } from "../src/db/client";
import { coingeckoProvider } from "../src/lib/pricing";
import {
  backfillCryptoPrices,
  backfillCryptoValuations,
} from "../src/lib/price-backfill";

async function main() {
  const prices = await backfillCryptoPrices(db, {
    fetchHistory: coingeckoProvider.fetchHistory,
  });
  console.log("prices:", JSON.stringify(prices, null, 2));
  const valuations = await backfillCryptoValuations(db);
  console.log("valuations:", JSON.stringify(valuations, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
