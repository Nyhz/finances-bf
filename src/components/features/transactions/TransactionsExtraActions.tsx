"use client";

import * as React from "react";
import { ArrowLeftRight, TrendingUp } from "lucide-react";
import { Button } from "@/src/components/ui/Button";
import { CreateSwapModal } from "./CreateSwapModal";
import { CreateDividendModal } from "./CreateDividendModal";

type Props = {
  accounts: { id: string; name: string }[];
  assets: { id: string; name: string }[];
};

export function TransactionsExtraActions({ accounts, assets }: Props) {
  const [swapOpen, setSwapOpen] = React.useState(false);
  const [dividendOpen, setDividendOpen] = React.useState(false);
  const disabled = accounts.length === 0 || assets.length === 0;

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          size="md"
          variant="secondary"
          onClick={() => setDividendOpen(true)}
          disabled={disabled}
        >
          <TrendingUp className="h-4 w-4" />
          Record dividend
        </Button>
        <Button
          size="md"
          variant="secondary"
          onClick={() => setSwapOpen(true)}
          disabled={disabled}
        >
          <ArrowLeftRight className="h-4 w-4" />
          Record swap
        </Button>
      </div>
      <CreateSwapModal
        open={swapOpen}
        onOpenChange={setSwapOpen}
        accounts={accounts}
        assets={assets}
      />
      <CreateDividendModal
        open={dividendOpen}
        onOpenChange={setDividendOpen}
        accounts={accounts}
        assets={assets}
      />
    </>
  );
}
