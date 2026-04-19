"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { reimportAccount } from "@/src/actions/reimportAccount";

export type ReimportAccountButtonProps = {
  accountId: string;
};

export function ReimportAccountButton({ accountId }: ReimportAccountButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    const result = await reimportAccount({ accountId });
    if (result.ok) {
      router.push(`/imports/new?accountId=${accountId}`);
    } else {
      setError(result.error.message);
    }
  }

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Re-import account
      </Button>

      <ConfirmModal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title="Re-import this account?"
        description={
          <div className="flex flex-col gap-2">
            <p>
              This permanently deletes every trade, cash movement, and tax lot for
              this account. You will then upload a fresh CSV to repopulate it. This
              cannot be undone.
            </p>
            {error && (
              <p className="text-sm font-medium text-destructive">{error}</p>
            )}
          </div>
        }
        confirmLabel="Wipe and re-import"
        confirmVariant="danger"
        onConfirm={handleConfirm}
      />
    </>
  );
}
