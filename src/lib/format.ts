import { format as fnsFormat } from "date-fns";

const LOCALE = "en-IE";

const eurFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatEur(amount: number): string {
  return eurFormatter.format(amount);
}

export function formatMoney(amount: number, currency: string): string {
  if (!currency) {
    throw new Error("formatMoney: currency is required");
  }
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercent(ratio: number): string {
  return percentFormatter.format(ratio);
}

export function formatDate(date: Date | string | number): string {
  return fnsFormat(new Date(date), "yyyy-MM-dd");
}

export function formatDateTime(date: Date | string | number): string {
  return fnsFormat(new Date(date), "yyyy-MM-dd HH:mm");
}
