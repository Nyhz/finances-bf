/**
 * Clean-slate wipe for manual re-entry: deletes the entire portfolio
 * (accounts, transactions, cash movements, tax rows, valuations, balances,
 * audit) but KEEPS the three external reference feeds so nothing has to be
 * re-downloaded or re-typed:
 *   - assets         (catalog: names, ISINs, symbols, currencies)
 *   - price_history  (raw daily Yahoo/CoinGecko bars)
 *   - fx_rates       (daily FX — needed the moment a USD trade is re-entered)
 *
 * Differs from the wipeApp action, which also drops fx_rates.
 */
import { db } from "../src/db/client";
import {
  accountCashMovements,
  accounts,
  assetPositions,
  assetTransactions,
  assetValuations,
  auditEvents,
  dailyBalances,
  taxLotConsumptions,
  taxLots,
  taxWashSaleAdjustments,
  taxYearSnapshots,
} from "../src/db/schema";
import { ulid } from "ulid";

const counts: Record<string, number> = {};

db.transaction((tx) => {
  const wipe = (label: string, table: Parameters<typeof tx.delete>[0]) => {
    counts[label] = tx.delete(table).run().changes;
  };
  // Children first.
  wipe("tax_wash_sale_adjustments", taxWashSaleAdjustments);
  wipe("tax_lot_consumptions", taxLotConsumptions);
  wipe("tax_lots", taxLots);
  wipe("tax_year_snapshots", taxYearSnapshots);
  wipe("account_cash_movements", accountCashMovements);
  wipe("asset_transactions", assetTransactions);
  wipe("asset_positions", assetPositions);
  wipe("asset_valuations", assetValuations);
  wipe("daily_balances", dailyBalances);
  wipe("accounts", accounts);
  wipe("audit_events", auditEvents);

  tx.insert(auditEvents).values({
    id: ulid(),
    entityType: "app",
    entityId: "portfolio",
    action: "wipe-keep-reference",
    actorType: "user",
    source: "script",
    summary: "portfolio wiped for manual re-entry; assets/price_history/fx_rates kept",
    previousJson: JSON.stringify(counts),
    nextJson: null,
    contextJson: JSON.stringify({ actor: "commander-cli" }),
    createdAt: Date.now(),
  }).run();
});

console.log("wiped:", JSON.stringify(counts, null, 2));
console.log("kept: assets, price_history, fx_rates");
