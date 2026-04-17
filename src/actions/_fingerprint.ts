import { createHash } from "node:crypto";

export function transactionFingerprint(parts: {
  accountId: string;
  assetId: string;
  tradeDate: string;
  side: "buy" | "sell";
  quantity: number;
  priceNative: number;
}): string {
  const key = [
    "manual",
    parts.accountId,
    parts.assetId,
    parts.tradeDate,
    parts.side,
    parts.quantity.toFixed(8),
    parts.priceNative.toFixed(8),
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export function cashMovementFingerprint(parts: {
  accountId: string;
  kind: string;
  occurredAt: string;
  amountNative: number;
  currency: string;
}): string {
  const key = [
    "manual",
    parts.accountId,
    parts.kind,
    parts.occurredAt,
    parts.amountNative.toFixed(8),
    parts.currency,
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}
