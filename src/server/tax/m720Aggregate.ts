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
    const cur = map.get(key) ?? { country: b.accountCountry, type, valueEur: 0 };
    cur.valueEur += b.valueEur;
    map.set(key, cur);
  }
  return [...map.values()];
}
