import "server-only";
import { revalidatePath } from "next/cache";

export {
  ACTOR,
  ASSET_TYPES,
  ACCOUNT_TYPES,
  CASH_BEARING_ACCOUNT_TYPES,
  isCashBearingAccount,
} from "./_constants";
export type {
  ActionError,
  ActionResult,
  AssetType,
  AccountType,
} from "./_constants";

/**
 * Every action that mutates `asset_transactions` or its derived state needs
 * to invalidate the same set of pages (Overview, Accounts, Transactions,
 * Assets, Taxes, Audit, and the specific account's detail page).
 *
 * Centralising these helpers means future route additions / renames are a
 * single edit. Previously, each action maintained its own ad-hoc list and
 * they drifted — some missed `/taxes`, some missed `/audit`, etc.
 */
export function revalidateTradeMutation(accountId: string): void {
  for (const p of [
    "/",
    "/overview",
    "/accounts",
    "/transactions",
    "/assets",
    "/taxes",
    "/audit",
  ]) {
    revalidatePath(p);
  }
  revalidatePath(`/accounts/${accountId}`);
}

export function revalidateCashMovement(accountId: string): void {
  for (const p of [
    "/",
    "/overview",
    "/accounts",
    "/transactions",
    "/audit",
  ]) {
    revalidatePath(p);
  }
  revalidatePath(`/accounts/${accountId}`);
}

export function revalidateAssetMetadata(): void {
  for (const p of ["/assets", "/overview", "/audit"]) {
    revalidatePath(p);
  }
}

export function revalidateAccountMutation(): void {
  for (const p of ["/", "/overview", "/accounts", "/audit"]) {
    revalidatePath(p);
  }
}

export function revalidateTaxEvent(year?: number): void {
  revalidatePath("/taxes");
  revalidatePath("/audit");
  if (year != null) revalidatePath(`/taxes/${year}`);
}
