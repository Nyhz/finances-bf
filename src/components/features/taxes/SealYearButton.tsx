"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { sealYear } from "@/src/actions/sealYear";

type Props = { year: number };

export function SealYearButton({ year }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConfirm() {
    setError(null);
    const result = await sealYear({ year });
    if (!result.ok) {
      setError(result.error.message);
      // keep modal open so the error is visible
      return;
    }
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Seal year</Button>
      <ConfirmModal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={`Seal ${year}?`}
        description={
          <div className="space-y-2">
            <p>
              Sealing writes a snapshot of this year&apos;s tax report. Later edits to
              transactions in {year} will produce a drift indicator instead of changing
              the filed numbers silently.
            </p>
            {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
          </div>
        }
        confirmLabel="Seal"
        confirmVariant="primary"
        onConfirm={handleConfirm}
      />
    </>
  );
}
