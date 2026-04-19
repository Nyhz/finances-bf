import { db } from "../src/db/client";
import {
  accounts,
  assetTransactions,
  accountCashMovements,
  taxLots,
  taxLotConsumptions,
  taxWashSaleAdjustments,
  auditEvents,
  transactionImports,
  transactionImportRows,
} from "../src/db/schema";
import { eq, inArray } from "drizzle-orm";
import { recomputeLotsForAsset } from "../src/server/tax/lots";
import { ulid } from "ulid";

const name = process.argv[2];
if (!name) { console.error("usage: tsx scripts/wipe-account-by-name.ts <accountName>"); process.exit(1); }

const acc = db.select().from(accounts).where(eq(accounts.name, name)).get();
if (!acc) { console.error("not found:", name); process.exit(1); }
console.log("Wiping", acc.name, acc.id);

db.transaction((tx) => {
  const txns = tx.select().from(assetTransactions).where(eq(assetTransactions.accountId, acc.id)).all();
  const assetIds = [...new Set(txns.map((t) => t.assetId))];
  const txnIds = txns.map((t) => t.id);
  if (txnIds.length > 0) {
    tx.delete(taxWashSaleAdjustments).where(inArray(taxWashSaleAdjustments.saleTransactionId, txnIds)).run();
    tx.delete(taxLotConsumptions).where(inArray(taxLotConsumptions.saleTransactionId, txnIds)).run();
    tx.delete(taxLots).where(inArray(taxLots.originTransactionId, txnIds)).run();
  }
  tx.delete(assetTransactions).where(eq(assetTransactions.accountId, acc.id)).run();
  tx.delete(accountCashMovements).where(eq(accountCashMovements.accountId, acc.id)).run();
  // Delete DEGIRO-format import sessions (transaction_imports has no accountId).
  const imports = tx.select().from(transactionImports).where(inArray(transactionImports.format, ["degiro", "degiro-statement"])).all();
  const importIds = imports.map((i) => i.id);
  if (importIds.length > 0) {
    tx.delete(transactionImportRows).where(inArray(transactionImportRows.importId, importIds)).run();
    tx.delete(transactionImports).where(inArray(transactionImports.id, importIds)).run();
  }
  for (const aid of assetIds) recomputeLotsForAsset(tx, aid);
  tx.insert(auditEvents).values({
    id: ulid(), entityType: "account", entityId: acc.id,
    action: "reimport-wipe", actorType: "user", source: "script",
    summary: `wiped ${txns.length} txns, ${imports.length} imports`,
    previousJson: JSON.stringify({ txnCount: txns.length, importCount: imports.length }),
    nextJson: null,
    contextJson: JSON.stringify({ actor: "commander-cli" }),
    createdAt: Date.now(),
  }).run();
  console.log(`deleted ${txns.length} transactions, ${imports.length} import sessions`);
});
