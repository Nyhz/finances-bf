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
  accountIds: string[];
};

export function OverviewFilters({ accounts, range, accountIds }: Props) {
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

  const setAccounts = React.useCallback(
    (next: string[]) => {
      update({ accounts: next.length === 0 ? null : next.join(",") });
    },
    [update],
  );

  // Single-select: clicking the active account toggles it off (back to "All"),
  // clicking another replaces the selection.
  const selectAccount = React.useCallback(
    (id: string) => {
      setAccounts(accountIds[0] === id ? [] : [id]);
    },
    [accountIds, setAccounts],
  );

  const allActive = accountIds.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div
        role="group"
        aria-label="Account filter"
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1"
      >
        <button
          type="button"
          onClick={() => setAccounts([])}
          aria-pressed={allActive}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            allActive
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          All
        </button>
        {accounts.map((a) => {
          const active = accountIds[0] === a.id;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => selectAccount(a.id)}
              aria-pressed={active}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {a.name}
            </button>
          );
        })}
      </div>

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
    </div>
  );
}
