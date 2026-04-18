import { asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "../src/db/client";
import {
  assetPositions,
  assetTransactions,
  assetValuations,
  assets,
  fxRates,
  priceHistory,
} from "../src/db/schema";
import { toIsoDate } from "../src/lib/fx";

function isWeekday(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
}

function weekdaysBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const end = new Date(`${toIso}T12:00:00Z`).getTime();
  for (
    let t = new Date(`${fromIso}T12:00:00Z`).getTime();
    t <= end;
    t += 86_400_000
  ) {
    const iso = toIsoDate(new Date(t));
    if (isWeekday(iso)) out.push(iso);
  }
  return out;
}

function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

async function main() {
  const now = Date.now();
  const today = toIsoDate(new Date());
  console.log("wiping asset_valuations…");
  db.delete(assetValuations).run();

  const activeAssets = db
    .select()
    .from(assets)
    .where(eq(assets.isActive, true))
    .all();

  let inserted = 0;
  for (const asset of activeAssets) {
    const symbol = (asset.providerSymbol ?? asset.symbol ?? "").trim();
    if (!symbol) continue;
    const pos = db
      .select()
      .from(assetPositions)
      .where(eq(assetPositions.assetId, asset.id))
      .get();
    if (!pos || pos.quantity <= 0) continue;

    const firstTx = db
      .select()
      .from(assetTransactions)
      .where(eq(assetTransactions.assetId, asset.id))
      .orderBy(asc(assetTransactions.tradedAt))
      .get();
    if (!firstTx) continue;

    // Pull all price bars for this symbol into a sorted array.
    const bars = db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.symbol, symbol))
      .orderBy(asc(priceHistory.pricedDateUtc))
      .all();
    if (bars.length === 0) continue;

    // FX bars for the asset's currency (EUR → rate always 1).
    const fxRows =
      asset.currency === "EUR"
        ? []
        : db
            .select()
            .from(fxRates)
            .where(eq(fxRates.currency, asset.currency))
            .orderBy(asc(fxRates.date))
            .all();

    const firstIso = toIsoDate(new Date(firstTx.tradedAt));
    const days = weekdaysBetween(firstIso, today);

    let barIdx = 0;
    let lastPrice: number | null = null;
    let fxIdx = 0;
    let lastFx: number | null = asset.currency === "EUR" ? 1 : null;

    for (const day of days) {
      // Advance through bars to catch any with date <= day.
      while (barIdx < bars.length && bars[barIdx].pricedDateUtc <= day) {
        lastPrice = bars[barIdx].price;
        barIdx++;
      }
      if (asset.currency !== "EUR") {
        while (fxIdx < fxRows.length && fxRows[fxIdx].date <= day) {
          lastFx = fxRows[fxIdx].rateToEur;
          fxIdx++;
        }
      }
      if (lastPrice == null || lastFx == null) continue;
      // Recompute quantity held end-of-day by walking trades up to that date.
      const dayEnd = new Date(`${day}T23:59:59Z`).getTime();
      let qty = 0;
      const trades = db
        .select()
        .from(assetTransactions)
        .where(eq(assetTransactions.assetId, asset.id))
        .orderBy(asc(assetTransactions.tradedAt))
        .all();
      for (const t of trades) {
        if (t.tradedAt > dayEnd) break;
        if (t.transactionType === "buy") qty += t.quantity;
        else if (t.transactionType === "sell") qty -= t.quantity;
      }
      if (qty <= 0) continue;

      const unitPriceEur = round(lastPrice * lastFx, 6);
      const marketValueEur = round(unitPriceEur * qty, 2);
      db.insert(assetValuations)
        .values({
          id: ulid(),
          assetId: asset.id,
          valuationDate: day,
          quantity: round(qty, 10),
          unitPriceEur,
          marketValueEur,
          priceSource: "rebuilt",
          createdAt: now,
        })
        .run();
      inserted++;
    }
    console.log(`  ${asset.name} [${symbol}]: ${days.length} weekdays processed`);
  }
  console.log(`valuations inserted: ${inserted}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
