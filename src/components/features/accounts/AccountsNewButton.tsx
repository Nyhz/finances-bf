"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/src/components/ui/Button";
import { CreateAccountModal } from "./CreateAccountModal";

export function AccountsNewButton({
  label = "New Account",
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
      <CreateAccountModal open={open} onOpenChange={setOpen} />
    </>
  );
}
