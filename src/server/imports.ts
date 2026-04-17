import { desc } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { transactionImports, type TransactionImport } from "../db/schema";

export async function listImportBatches(db: DB = defaultDb): Promise<TransactionImport[]> {
  return db
    .select()
    .from(transactionImports)
    .orderBy(desc(transactionImports.createdAt))
    .all();
}
