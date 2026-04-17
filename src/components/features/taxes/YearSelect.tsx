"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/src/lib/cn";

export function YearSelect({
  years,
  value,
}: {
  years: number[];
  value: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = new URLSearchParams(params?.toString() ?? "");
    next.set("year", e.target.value);
    startTransition(() => {
      router.push(`/taxes?${next.toString()}`);
    });
  }

  return (
    <select
      value={value}
      onChange={onChange}
      disabled={pending}
      className={cn(
        "h-10 rounded-xl border border-border bg-secondary px-3 text-sm font-medium text-foreground",
        "focus:outline-none focus:ring-2 focus:ring-ring",
        pending && "opacity-60",
      )}
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}
