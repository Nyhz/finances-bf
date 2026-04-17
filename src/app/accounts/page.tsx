export const dynamic = "force-dynamic";

import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { AccountsNewButton } from "@/src/components/features/accounts/AccountsNewButton";
import { listAccounts, type AccountWithTotals } from "@/src/server/accounts";
import { formatEur, formatMoney } from "@/src/lib/format";

export default async function AccountsPage() {
  const rows = await listAccounts();

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
          <p className="text-sm text-muted-foreground">
            Cash balances by account, EUR-normalised.
          </p>
        </div>
        <AccountsNewButton />
      </header>

      {rows.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="No accounts yet"
          description="Add an account to track cash balances and trades."
        />
      ) : (
        <DataTable<AccountWithTotals>
          rows={rows}
          getRowKey={(r) => r.id}
          columns={[
            { key: "name", header: "Name", cell: (r) => r.name },
            {
              key: "type",
              header: "Institution",
              cell: (r) => r.accountType,
            },
            { key: "currency", header: "Currency", cell: (r) => r.currency },
            {
              key: "eur",
              header: "Balance (EUR)",
              align: "right",
              cell: (r) => (
                <SensitiveValue>{formatEur(r.currentCashBalanceEur)}</SensitiveValue>
              ),
            },
            {
              key: "native",
              header: "Balance (native)",
              align: "right",
              cell: (r) => (
                <SensitiveValue>
                  {formatMoney(r.currentCashBalanceEur, r.currency)}
                </SensitiveValue>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
