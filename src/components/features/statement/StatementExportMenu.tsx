"use client";

import { useState } from "react";
import { Button } from "@/src/components/ui/Button";

const items: { label: string; href: string }[] = [
  { label: "PDF report", href: "/api/exports/statement?format=pdf" },
  { label: "Excel workbook (.xlsx)", href: "/api/exports/statement?format=xlsx" },
  { label: "CSV", href: "/api/exports/statement?format=csv" },
];

export function StatementExportMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button onClick={() => setOpen((s) => !s)}>Generate statement ▾</Button>
      {open ? (
        <div className="absolute right-0 mt-1 w-60 rounded-md border border-border bg-popover p-1 shadow-lg z-10">
          {items.map((it) => (
            <a
              key={it.href}
              href={it.href}
              className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
              onClick={() => setOpen(false)}
            >
              {it.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
