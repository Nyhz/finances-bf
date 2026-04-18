"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/src/lib/cn";

export type CollapsibleCardProps = {
  title: React.ReactNode;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
};

export function CollapsibleCard({
  title,
  action,
  defaultOpen = true,
  className,
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left text-sm font-semibold tracking-tight"
          aria-expanded={open}
        >
          <ChevronDown
            className={cn("size-4 transition-transform", !open && "-rotate-90")}
          />
          {title}
        </button>
        {action}
      </div>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}
