/* PREVIEW — delete when Phase 3 lands. */
"use client";

import * as React from "react";
import { TrendingUp, Wallet } from "lucide-react";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { DataTable } from "@/src/components/ui/DataTable";
import { KPICard } from "@/src/components/ui/KPICard";
import { Modal } from "@/src/components/ui/Modal";
import { SensitiveToggle } from "@/src/components/ui/SensitiveToggle";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { ThemeToggle } from "@/src/components/ui/ThemeToggle";

type Row = { ticker: string; qty: number; valueEur: number };

const rows: Row[] = [
  { ticker: "IWDA.AS", qty: 42, valueEur: 3820.55 },
  { ticker: "VWCE.DE", qty: 18, valueEur: 1920.12 },
  { ticker: "BTC", qty: 0.25, valueEur: 12450.0 },
];

export default function PreviewPage() {
  const [modalOpen, setModalOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            UI Primitives — preview
          </h1>
          <p className="text-sm text-muted-foreground">
            PREVIEW — delete when Phase 3 lands.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <SensitiveToggle />
          <ThemeToggle />
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <KPICard
          label="Portfolio"
          value="€18,190.67"
          delta={{ value: "+1.4% today", direction: "up" }}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <KPICard
          label="Cash"
          value="€2,304.00"
          delta={{ value: "−€120.00 this week", direction: "down" }}
          icon={<Wallet className="h-5 w-5" />}
        />
        <KPICard
          label="YTD Return"
          value="+€1,240.12"
          delta={{ value: "flat vs. last week", direction: "flat" }}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Buttons
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
          <Button asChild variant="secondary">
            <a href="#">Link as button</a>
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Badges
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Neutral</Badge>
          <Badge variant="success">Synced</Badge>
          <Badge variant="warning">Stale</Badge>
          <Badge variant="danger">Error</Badge>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          DataTable
        </h2>
        <DataTable<Row>
          columns={[
            { key: "ticker", header: "Ticker", cell: (r) => r.ticker },
            {
              key: "qty",
              header: "Qty",
              align: "right",
              cell: (r) => (
                <span className="tabular-nums">{r.qty.toFixed(4)}</span>
              ),
            },
            {
              key: "value",
              header: "Value",
              align: "right",
              cell: (r) => (
                <SensitiveValue>
                  €
                  {r.valueEur.toLocaleString("en-IE", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </SensitiveValue>
              ),
            },
          ]}
          rows={rows}
          getRowKey={(r) => r.ticker}
          footer={
            <>
              <span>3 positions</span>
              <span>cursor: demo</span>
            </>
          }
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Cards
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="Cash" action={<Badge variant="success">Synced</Badge>}>
            <p className="text-sm text-muted-foreground">
              Arbitrary content inside a card slot.
            </p>
          </Card>
          <Card title="With footer" footer="Updated just now">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          StatesBlock
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatesBlock mode="loading" />
          <StatesBlock
            mode="empty"
            title="No transactions yet"
            description="Import a CSV or add one manually to see it here."
            cta={{ label: "Add transaction", href: "#" }}
          />
          <StatesBlock
            mode="error"
            message="Couldn't load positions."
            onRetry={() => undefined}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Modals
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setModalOpen(true)}>Open Modal</Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            Open ConfirmModal
          </Button>
        </div>
        <Modal
          open={modalOpen}
          onOpenChange={setModalOpen}
          title="Example modal"
          description="Radix Dialog wrapped in our theme tokens."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setModalOpen(false)}>Save</Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            Modal content renders here.
          </p>
        </Modal>
        <ConfirmModal
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Delete transaction?"
          description="This cannot be undone."
          confirmLabel="Delete"
          onConfirm={async () => {
            await new Promise((r) => setTimeout(r, 500));
          }}
        />
      </section>
    </main>
  );
}
