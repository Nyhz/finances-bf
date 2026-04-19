"use client";

import { useState } from "react";
import { Button } from "@/src/components/ui/Button";

type Props = { year: number };

export function ExportMenu({ year }: Props) {
  const [open, setOpen] = useState(false);
  const items: { label: string; href: string }[] = [
    { label: "PDF report", href: `/api/exports/tax/pdf?year=${year}` },
    { label: "Casillas CSV (Modelo 100 paste)", href: `/api/exports/tax/casillas?year=${year}` },
    { label: "Detail CSV (comprobación dossier)", href: `/api/exports/tax/detail?year=${year}` },
    { label: "Modelo 720 diff (JSON)", href: `/api/exports/tax/m720-diff?year=${year}&format=json` },
    { label: "Modelo 720 diff (CSV)", href: `/api/exports/tax/m720-diff?year=${year}&format=csv` },
  ];
  return (
    <div className="relative">
      <Button onClick={() => setOpen((s) => !s)}>Export ▾</Button>
      {open ? (
        <div className="absolute right-0 mt-1 w-72 rounded-md border border-border bg-popover p-1 shadow-lg z-10">
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
