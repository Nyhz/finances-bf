export function countryFromIsin(isin: string): string | null {
  if (!isin || isin.length < 2) return null;
  const prefix = isin.slice(0, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(prefix)) return null;
  // Any A-Z prefix passes through deliberately (XS/EU etc. fall to the default treaty rate).
  return prefix;
}

const DDI_RATES: Record<string, number> = {
  US: 0.15,
  ES: 0,
  IE: 0,
  LU: 0.15,
  GB: 0,
  DE: 0.15,
  FR: 0.15,
  NL: 0.15,
  CH: 0.15,
};

export function ddiTreatyRate(country: string): number {
  if (country === "ES") return 0;
  return DDI_RATES[country] ?? 0.15;
}
