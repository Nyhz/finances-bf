export const dynamic = "force-dynamic";

import Link from "next/link";
import { Button } from "@/src/components/ui/Button";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { listTransactions } from "@/src/server/transactions";
import { listAccounts } from "@/src/server/accounts";
import { listAssets } from "@/src/server/assets";
import { formatEur, formatDateTime } from "@/src/lib/format";
import type { AssetTransaction } from "@/src/db/schema";
import { TransactionsNewButton } from "@/src/components/features/transactions/TransactionsNewButton";
import { TransactionsExtraActions } from "@/src/components/features/transactions/TransactionsExtraActions";
import { DeleteTransactionButton } from "@/src/components/features/transactions/DeleteTransactionButton";

type SearchParams = Promise<{ cursor?: string }>;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { cursor } = await searchParams;
  const [result, accounts, assets] = await Promise.all([
    listTransactions({ cursor, limit: 50 }),
    listAccounts(),
    listAssets(),
  ]);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const assetName = new Map(assets.map((a) => [a.id, a.symbol ?? a.name]));

  const nextHref = result.nextCursor
    ? `/transactions?cursor=${encodeURIComponent(result.nextCursor)}`
    : null;
  const prevHref = cursor ? "/transactions" : null;

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground">
            Unified timeline of trades and cash movements.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TransactionsExtraActions
            accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
            assets={assets.map((a) => ({ id: a.id, name: a.name }))}
          />
          <TransactionsNewButton
            accounts={accounts
              .filter((a) => a.accountType !== "savings")
              .map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
            assets={assets.map((a) => ({
              id: a.id,
              name: a.name,
              symbol: a.symbol ?? null,
              currency: a.currency,
            }))}
            cashAccounts={accounts
              .filter((a) => a.accountType === "savings")
              .map((a) => ({
                id: a.id,
                name: a.name,
                currency: a.currency,
                accountType: a.accountType,
              }))}
          />
        </div>
      </header>

      {result.items.length === 0 && !cursor ? (
        <StatesBlock
          mode="empty"
          title="No transactions yet"
          description="Import a CSV or record a trade to populate the timeline."
        />
      ) : (
        <DataTable<AssetTransaction>
          rows={result.items}
          getRowKey={(r) => r.id}
          emptyState="No transactions on this page."
          columns={[
            {
              key: "date",
              header: "Date",
              cell: (r) => formatDateTime(r.tradedAt),
            },
            {
              key: "account",
              header: "Account",
              cell: (r) => accountName.get(r.accountId) ?? r.accountId,
            },
            {
              key: "asset",
              header: "Asset",
              cell: (r) => assetName.get(r.assetId) ?? r.assetId,
            },
            { key: "type", header: "Type", cell: (r) => r.transactionType },
            {
              key: "qty",
              header: "Qty",
              align: "right",
              cell: (r) => (
                <span className="tabular-nums">{r.quantity.toFixed(4)}</span>
              ),
            },
            {
              key: "price",
              header: "Price",
              align: "right",
              cell: (r) => (
                <span className="tabular-nums">{r.unitPrice.toFixed(4)}</span>
              ),
            },
            {
              key: "fx",
              header: "FX → EUR",
              align: "right",
              cell: (r) => (
                <span className="tabular-nums text-xs text-muted-foreground">
                  {r.tradeCurrency === "EUR" ? "—" : r.fxRateToEur.toFixed(6)}
                </span>
              ),
            },
            {
              key: "total",
              header: "Total (EUR)",
              align: "right",
              cell: (r) => (
                <SensitiveValue>{formatEur(r.tradeGrossAmountEur)}</SensitiveValue>
              ),
            },
            {
              key: "fee",
              header: "Fee (EUR)",
              align: "right",
              cell: (r) => (
                <SensitiveValue>{formatEur(r.feesAmountEur)}</SensitiveValue>
              ),
            },
            {
              key: "actions",
              header: "",
              align: "right",
              cell: (r) => <DeleteTransactionButton id={r.id} />,
            },
          ]}
          footer={
            <>
              <span>{result.items.length} rows</span>
              <span className="flex items-center gap-2">
                {prevHref ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={prevHref}>Prev</Link>
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" disabled>
                    Prev
                  </Button>
                )}
                {nextHref ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={nextHref}>Next</Link>
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" disabled>
                    Next
                  </Button>
                )}
              </span>
            </>
          }
        />
      )}
    </div>
  );
}
