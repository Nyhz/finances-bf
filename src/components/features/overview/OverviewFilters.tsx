"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/src/lib/cn";

const OVERVIEW_RANGES = ["1M", "3M", "6M", "YTD", "1Y", "ALL"] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

export type OverviewFilterAccount = {
  id: string;
  name: string;
};

type Props = {
  accounts: OverviewFilterAccount[];
  range: OverviewRange;
  accountId: string | null;
};

export function OverviewFilters({ accounts, range, accountId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const update = React.useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") params.delete(k);
        else params.set(k, v);
      }
      const qs = params.toString();
      router.replace(qs ? `/?${qs}` : "/", { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="tablist"
        aria-label="Range"
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1"
      >
        {OVERVIEW_RANGES.map((r) => {
          const active = r === range;
          return (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => update({ range: r === "ALL" ? null : r })}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {r}
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Account</span>
        <select
          value={accountId ?? ""}
          onChange={(e) => update({ accountId: e.target.value || null })}
          className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
