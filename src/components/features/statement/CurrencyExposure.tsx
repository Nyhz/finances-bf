import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur, formatPercent } from "@/src/lib/format";

export type CurrencySlice = {
  currency: string;
  valueEur: number;
  /** Share of valued positions, 0..1. */
  weight: number;
};

const BAR_COLORS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"];

/** Underlying-currency exposure of the invested portfolio: a USD-quoted ETF
 *  is dollar exposure even though the panel values it in EUR. Plain divs on
 *  theme tokens — no chart runtime needed for five bars. */
export function CurrencyExposure({ slices }: { slices: CurrencySlice[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {slices.map((s, i) => (
        <li key={s.currency} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-sm">
            <span className="flex items-center gap-2 font-medium">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: `hsl(var(${BAR_COLORS[i % BAR_COLORS.length]}))` }}
              />
              {s.currency}
            </span>
            <span className="flex items-baseline gap-2">
              <SensitiveValue className="text-xs text-muted-foreground tabular-nums">
                {formatEur(s.valueEur)}
              </SensitiveValue>
              <span className="w-14 text-right text-sm font-medium tabular-nums">
                {formatPercent(s.weight)}
              </span>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(1, s.weight * 100)}%`,
                backgroundColor: `hsl(var(${BAR_COLORS[i % BAR_COLORS.length]}))`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
