"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { deleteTransaction } from "@/src/actions/deleteTransaction";

export function DeleteTransactionButton({ id }: { id: string }) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onConfirm() {
    setError(null);
    const result = await deleteTransaction({ id });
    if (!result.ok) {
      setError(result.error.message);
      throw new Error(result.error.message);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Delete transaction"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <ConfirmModal
        open={open}
        onOpenChange={setOpen}
        title="Delete transaction"
        description={
          error ??
          "This reverses the position and cash-balance impact and writes an audit event. This cannot be undone."
        }
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />
    </>
  );
}
