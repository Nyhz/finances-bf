import { revalidatePath } from "next/cache";

export const ACTOR = "commander";

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

export type ActionError = {
  code: "validation" | "db" | "not_found" | "conflict";
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export const ASSET_TYPES = [
  "etf",
  "stock",
  "bond",
  "crypto",
  "fund",
  "cash-equivalent",
  "other",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ACCOUNT_TYPES = [
  "broker",
  "crypto",
  "investment",
  "savings",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

// Only savings tracks a cash balance. Broker / crypto / investment are pure
// position containers — buys don't debit cash, sells don't credit it.
export const CASH_BEARING_ACCOUNT_TYPES = ["savings"] as const;

export function isCashBearingAccount(type: string): boolean {
  return (CASH_BEARING_ACCOUNT_TYPES as readonly string[]).includes(type);
}
