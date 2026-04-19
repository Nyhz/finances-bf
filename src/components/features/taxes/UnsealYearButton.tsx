"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { unsealYear } from "@/src/actions/unsealYear";

type Props = { year: number };

export function UnsealYearButton({ year }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConfirm() {
    setError(null);
    const result = await unsealYear({ year });
    if (!result.ok) {
      setError(result.error.message);
      // keep modal open so the error is visible
      return;
    }
    router.refresh();
  }

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Unseal year
      </Button>
      <ConfirmModal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={`Unseal ${year}?`}
        description={
          <div className="space-y-2">
            <p>
              Unsealing deletes the snapshot. The year&apos;s numbers will go back to being
              recomputed live — any edits made since sealing will silently take effect.
              Only unseal if you need to correct the sealed record.
            </p>
            {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
          </div>
        }
        confirmLabel="Unseal"
        confirmVariant="danger"
        onConfirm={handleConfirm}
      />
    </>
  );
}
