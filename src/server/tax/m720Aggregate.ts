import { roundEur } from "../../lib/money";
import { marketEur } from "../../lib/money-types";
import type { YearEndBalance } from "./report";
import type { Model720Block } from "./m720";

export function aggregateBlocksFromBalances(balances: YearEndBalance[]): Model720Block[] {
  const map = new Map<string, Model720Block>();
  for (const b of balances) {
    if (!b.accountCountry) continue;
    const type: Model720Block["type"] =
      b.assetClassTax === "crypto"
        ? "crypto"
        : b.accountType === "bank" || b.accountType === "savings"
          ? "bank-accounts"
          : "broker-securities";
    const key = `${b.accountCountry}::${type}`;
    const cur =
      map.get(key) ??
      { country: b.accountCountry, type, valueEur: marketEur(0), hasUnvalued: false, hasStale: false };
    // Unvalued positions contribute nothing to the sum but taint the block —
    // a silent zero here is exactly what audit T4 forbids.
    cur.valueEur = marketEur(roundEur(cur.valueEur + (b.valueEur ?? 0)));
    cur.hasUnvalued = cur.hasUnvalued || b.unvalued;
    cur.hasStale = cur.hasStale || b.staleValuation;
    map.set(key, cur);
  }
  return [...map.values()];
}
