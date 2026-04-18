import { db } from "../src/db/client";
import { fetchQuote } from "../src/lib/pricing";
import { syncPrices } from "../src/lib/price-sync";

async function main() {
  const summary = await syncPrices(db, { fetchQuote });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
