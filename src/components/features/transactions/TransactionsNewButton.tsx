"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/src/components/ui/Button";
import {
  CreateTransactionModal,
  type AccountOption,
  type AssetOption,
} from "./CreateTransactionModal";

export function TransactionsNewButton({
  accounts,
  assets,
}: {
  accounts: AccountOption[];
  assets: AssetOption[];
}) {
  const [open, setOpen] = React.useState(false);
  const disabled = accounts.length === 0 || assets.length === 0;

  return (
    <>
      <Button size="md" onClick={() => setOpen(true)} disabled={disabled}>
        <Plus className="h-4 w-4" />
        New transaction
      </Button>
      <CreateTransactionModal
        open={open}
        onOpenChange={setOpen}
        accounts={accounts}
        assets={assets}
      />
    </>
  );
}
