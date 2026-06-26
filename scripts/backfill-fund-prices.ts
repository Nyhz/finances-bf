import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
import { asc } from "drizzle-orm";
import { db } from "../src/db/client";
import { assetTransactions } from "../src/db/schema";
import { ftProvider } from "../src/lib/pricing";
import {
  backfillFundPrices,
  backfillFundValuations,
} from "../src/lib/price-backfill";

// One-off FT fund backfill. By default it seeds NAV history all the way back to
// the portfolio's FIRST EVER trade (so a newly-added fund gets a long series for
// the chart); valuations before the fund was actually held come out at quantity
// 0 and don't affect any total. Pass an ISO date as argv[2] to override the
// start, or "trade" to fall back to each fund's own first trade.
async function main() {
  const arg = process.argv[2];
  let from: Date | undefined;
  if (arg && arg !== "trade") {
    from = new Date(`${arg}T00:00:00.000Z`);
  } else if (!arg) {
    const earliest = await db
      .select({ tradedAt: assetTransactions.tradedAt })
      .from(assetTransactions)
      .orderBy(asc(assetTransactions.tradedAt))
      .limit(1)
      .get();
    if (earliest) from = new Date(earliest.tradedAt);
  }
  console.log(`from: ${from ? from.toISOString() : "(each fund's first trade)"}`);

  const prices = await backfillFundPrices(
    db,
    { fetchHistory: ftProvider.fetchHistory },
    undefined,
    { from },
  );
  console.log("prices:", JSON.stringify(prices, null, 2));
  const valuations = await backfillFundValuations(db);
  console.log("valuations:", JSON.stringify(valuations, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
