export type Quote = {
  symbol: string;
  price: number;
  currency: string;
  asOf: Date;
};

export type HistoricalBar = {
  date: string; // yyyy-MM-dd
  close: number;
  currency: string;
};

export type SectorWeight = {
  sector: string; // canonical Yahoo key, e.g. "technology"
  weight: number; // fraction 0..1
};

export type CoinCandidate = {
  id: string;
  symbol: string;
  name: string;
  marketCapRank: number | null;
  thumb?: string | null;
};
