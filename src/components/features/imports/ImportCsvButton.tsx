"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";

export function ImportCsvButton({
  label = "Import CSV",
  size = "md",
}: {
  label?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        {label}
      </Button>
      <ConfirmModal
        open={open}
        onOpenChange={setOpen}
        title="CSV importers coming soon"
        description="Importers land in the next campaign."
        confirmLabel="Got it"
        cancelLabel="Close"
        confirmVariant="primary"
        onConfirm={() => undefined}
      />
    </>
  );
}
