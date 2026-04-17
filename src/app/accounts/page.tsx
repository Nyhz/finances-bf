export const dynamic = "force-dynamic";

import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { AccountsNewButton } from "@/src/components/features/accounts/AccountsNewButton";
import { AccountsTable } from "@/src/components/features/accounts/AccountsTable";
import { listAccounts } from "@/src/server/accounts";

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
        <AccountsTable rows={rows} />
      )}
    </div>
  );
}
