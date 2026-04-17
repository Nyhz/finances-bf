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

const NOT_IMPLEMENTED = "pricing.ts not implemented — mission lands later";

/* eslint-disable @typescript-eslint/no-unused-vars */
export async function fetchQuote(symbol: string): Promise<Quote> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function fetchHistory(
  symbol: string,
  from: Date,
  to: Date,
): Promise<HistoricalBar[]> {
  throw new Error(NOT_IMPLEMENTED);
}
/* eslint-enable @typescript-eslint/no-unused-vars */
