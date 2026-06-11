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
          <h1 className="text-2xl font-semibold tracking-tight">Cuentas</h1>
          <p className="text-sm text-muted-foreground">
            Saldos de efectivo por cuenta, normalizados a EUR.
          </p>
        </div>
        <AccountsNewButton />
      </header>

      {rows.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="Sin cuentas"
          description="Añade una cuenta para registrar saldos de efectivo y operaciones."
        />
      ) : (
        <AccountsTable rows={rows} />
      )}
    </div>
  );
}
