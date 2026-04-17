"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";

export function AssetsNewButton({
  label = "New Asset",
  size = "md",
}: {
  label?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {label}
      </Button>
      <ConfirmModal
        open={open}
        onOpenChange={setOpen}
        title="Asset creation coming soon"
        description="The Create Asset action lands in the next campaign."
        confirmLabel="Got it"
        cancelLabel="Close"
        confirmVariant="primary"
        onConfirm={() => undefined}
      />
    </>
  );
}
