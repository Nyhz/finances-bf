"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { wipeApp } from "@/src/actions/wipeApp";

export function WipeAppCard() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    if (confirmation !== "WIPE") {
      setError("Type WIPE to confirm");
      throw new Error("confirmation missing");
    }
    const result = await wipeApp({ confirmation });
    if (!result.ok) {
      setError(result.error.message);
      throw new Error(result.error.message);
    }
    setConfirmation("");
    router.refresh();
  }

  return (
    <Card title="Danger zone">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">
          Wipe every account, transaction, cash movement, import session and
          audit entry. Assets and their price history are preserved.
        </p>
        <div>
          <Button variant="danger" onClick={() => setOpen(true)}>
            Wipe app
          </Button>
        </div>
      </div>

      <ConfirmModal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setConfirmation("");
            setError(null);
          }
        }}
        title="Wipe the entire app?"
        description={
          <div className="flex flex-col gap-3">
            <p>
              This permanently deletes every account, transaction, cash
              movement, import, and audit entry. Assets and their price history
              are kept.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                Type <span className="font-mono font-semibold">WIPE</span> to
                confirm:
              </span>
              <input
                type="text"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoFocus
                className="rounded-md border border-border bg-background px-2 py-1 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-destructive/40"
              />
            </label>
            {error && (
              <p className="text-sm font-medium text-destructive">{error}</p>
            )}
          </div>
        }
        confirmLabel="Wipe everything"
        confirmVariant="danger"
        onConfirm={handleConfirm}
      />
    </Card>
  );
}
