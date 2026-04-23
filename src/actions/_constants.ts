export const ACTOR = "commander";

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
