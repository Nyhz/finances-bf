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
