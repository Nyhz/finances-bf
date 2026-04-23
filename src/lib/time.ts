// Time helpers shared across server / lib / scripts. Consolidates what was
// previously duplicated as private functions in `server/overview.ts`,
// `server/savings.ts`, `server/valuations.ts`, `lib/fx-backfill.ts` and as
// inline `.toISOString().slice(0, 10)` calls in several more files.

export const DAY_MS = 86_400_000;

/** ISO yyyy-MM-dd in UTC. Accepts a Date or an already-formatted string. */
export function toIsoDate(date: Date | string): string {
  if (typeof date === "string") return date.slice(0, 10);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True when the UTC day-of-week is Mon-Fri. Weekends drop out of equity
 *  price feeds, so loops over weekday-only series use this to filter. */
export function isWeekday(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
}
