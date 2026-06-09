"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { sealYear } from "@/src/actions/sealYear";

type Props = { year: number; hasUnvalued?: boolean };

export function SealYearButton({ year, hasUnvalued = false }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const router = useRouter();

  async function handleConfirm() {
    setError(null);
    const result = await sealYear({ year, acknowledgeUnvalued: acknowledge });
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
          if (!next) {
            setError(null);
            setAcknowledge(false);
          }
        }}
        title={`Seal ${year}?`}
        description={
          <div className="space-y-2">
            <p>
              Sealing writes a snapshot of this year&apos;s tax report. Later edits to
              transactions in {year} will produce a drift indicator instead of changing
              the filed numbers silently.
            </p>
            {hasUnvalued ? (
              <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledge}
                  onChange={(e) => setAcknowledge(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Some foreign year-end balances are <strong>unvalued</strong> — the
                  M720/M721 declaration thresholds may be wrong. Seal anyway with these
                  incomplete values.
                </span>
              </label>
            ) : null}
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
