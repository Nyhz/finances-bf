import { cn } from "@/src/lib/cn";

const STYLES: Record<
  string,
  { label: string; className: string; accent: string }
> = {
  crypto: {
    label: "Crypto",
    className:
      "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/25",
    accent: "bg-violet-500/70",
  },
  etf: {
    label: "ETF",
    className:
      "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25",
    accent: "bg-sky-500/70",
  },
  stock: {
    label: "Stock",
    className:
      "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25",
    accent: "bg-amber-500/70",
  },
  bond: {
    label: "Bond",
    className:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
    accent: "bg-emerald-500/70",
  },
  fund: {
    label: "Fund",
    className:
      "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25",
    accent: "bg-rose-500/70",
  },
  "cash-equivalent": {
    label: "Cash",
    className:
      "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/25",
    accent: "bg-slate-500/70",
  },
  other: {
    label: "Other",
    className:
      "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/25",
    accent: "bg-zinc-500/70",
  },
};

export function assetTypeAccentClass(type: string): string {
  return (STYLES[type] ?? STYLES.other).accent;
}

export function AssetTypeStripe({ type }: { type: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block w-[3px] shrink-0 self-stretch rounded-full",
        assetTypeAccentClass(type),
      )}
    />
  );
}

export function AssetTypeBadge({ type }: { type: string }) {
  const style = STYLES[type] ?? STYLES.other;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        style.className,
      )}
    >
      {style.label}
    </span>
  );
}
