export type AssetClassTax =
  | "listed_security"
  | "unlisted_security"
  | "fund"
  | "etf"
  | "crypto"
  | "bond"
  | "other";

export type ClassificationInput = {
  assetType?: string | null;
  subtype?: string | null;
  name?: string | null;
  ticker?: string | null;
  isin?: string | null;
};

export function inferAssetClassTax(input: ClassificationInput): AssetClassTax {
  const type = (input.assetType ?? "").toLowerCase();
  const name = (input.name ?? "").toLowerCase();
  const subtype = (input.subtype ?? "").toLowerCase();
  const ticker = (input.ticker ?? "").toLowerCase();

  if (type === "crypto" || subtype === "crypto") return "crypto";
  if (type === "bond" || subtype === "bond") return "bond";

  const looksLikeEtf =
    subtype === "etf" ||
    /\betf\b/.test(name) ||
    /ucits/.test(name) ||
    /ucits/.test(ticker) ||
    /^(vwce|vuaa|iwda|eimi|cspx|vusa)$/.test(ticker);
  if (looksLikeEtf) return "etf";

  if (type === "fund") return "fund";
  if (type === "equity" || type === "stock" || type === "share") return "listed_security";

  return "other";
}
