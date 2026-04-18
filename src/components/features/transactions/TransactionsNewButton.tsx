"use client";

import * as React from "react";
import { Plus, Wallet } from "lucide-react";
import { Button } from "@/src/components/ui/Button";
import {
  CreateTransactionModal,
  type AccountOption,
  type AssetOption,
} from "./CreateTransactionModal";
import {
  CreateCashMovementModal,
  type CashAccountOption,
} from "./CreateCashMovementModal";

export function TransactionsNewButton({
  accounts,
  assets,
  cashAccounts,
}: {
  accounts: AccountOption[];
  assets: AssetOption[];
  cashAccounts: CashAccountOption[];
}) {
  const [tradeOpen, setTradeOpen] = React.useState(false);
  const [cashOpen, setCashOpen] = React.useState(false);
  const tradeDisabled = accounts.length === 0 || assets.length === 0;
  const cashDisabled = cashAccounts.length === 0;

  return (
    <div className="flex items-center gap-2">
      <Button
        size="md"
        variant="secondary"
        onClick={() => setCashOpen(true)}
        disabled={cashDisabled}
      >
        <Wallet className="h-4 w-4" />
        New cash movement
      </Button>
      <Button size="md" onClick={() => setTradeOpen(true)} disabled={tradeDisabled}>
        <Plus className="h-4 w-4" />
        New transaction
      </Button>
      <CreateTransactionModal
        open={tradeOpen}
        onOpenChange={setTradeOpen}
        accounts={accounts}
        assets={assets}
      />
      <CreateCashMovementModal
        open={cashOpen}
        onOpenChange={setCashOpen}
        accounts={cashAccounts}
      />
    </div>
  );
}
