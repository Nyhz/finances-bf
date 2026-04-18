import YahooFinance from "yahoo-finance2";
import { db } from "../src/db/client";
import { assets } from "../src/db/schema";

const yahooFinance = new YahooFinance();

async function main() {
  const rows = db.select().from(assets).all();
  const results: Array<{
    id: string;
    name: string;
    isin: string | null;
    resolved: string | null;
    currency?: string;
    exchange?: string;
    candidates?: Array<{ symbol: string; exchange?: string; shortname?: string }>;
  }> = [];

  for (const a of rows) {
    if (a.providerSymbol || a.symbol) {
      results.push({ id: a.id, name: a.name, isin: a.isin, resolved: a.providerSymbol ?? a.symbol });
      continue;
    }
    const query = a.isin ?? a.name;
    if (!query) {
      results.push({ id: a.id, name: a.name, isin: a.isin, resolved: null });
      continue;
    }
    try {
      const res = (await yahooFinance.search(query, { quotesCount: 5, newsCount: 0 })) as {
        quotes: Array<{ symbol?: string; exchange?: string; shortname?: string; longname?: string }>;
      };
      const quotes = (res.quotes ?? []).filter((q) => q.symbol);
      results.push({
        id: a.id,
        name: a.name,
        isin: a.isin,
        resolved: quotes[0]?.symbol ?? null,
        candidates: quotes.map((q) => ({
          symbol: q.symbol!,
          exchange: q.exchange,
          shortname: q.shortname ?? q.longname,
        })),
      });
    } catch (err) {
      results.push({
        id: a.id,
        name: a.name,
        isin: a.isin,
        resolved: null,
        candidates: [{ symbol: `ERROR: ${(err as Error).message}` }],
      });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
