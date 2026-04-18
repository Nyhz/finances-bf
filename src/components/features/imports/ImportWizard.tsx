"use client";

import * as React from "react";
import { Upload, AlertTriangle } from "lucide-react";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { DataTable } from "@/src/components/ui/DataTable";
import { Modal } from "@/src/components/ui/Modal";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { previewImport } from "@/src/actions/previewImport";
import type {
  PreviewPayload,
  PreviewRow,
} from "@/src/actions/previewImport.schema";
import { confirmImport } from "@/src/actions/confirmImport";
import { formatMoney } from "@/src/lib/format";

export type AccountOption = { id: string; name: string };

type Step = "source" | "preview" | "done";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: AccountOption[];
};

function statusBadge(status: PreviewRow["status"]) {
  if (status === "duplicate") return <Badge variant="neutral">Duplicate</Badge>;
  if (status === "needs_asset_creation")
    return <Badge variant="warning">New asset</Badge>;
  return <Badge variant="success">New</Badge>;
}

function rowLabel(row: PreviewRow): string {
  if (row.kind === "trade") {
    return `${row.side?.toUpperCase()} ${row.quantity ?? ""} ${
      row.assetHint?.symbol ?? row.assetHint?.name ?? row.assetHint?.isin ?? ""
    }`.trim();
  }
  return `${row.movement ?? "cash"} ${row.assetHint?.name ?? ""}`.trim();
}

export function ImportWizard({ open, onOpenChange, accounts }: Props) {
  const [step, setStep] = React.useState<Step>("source");
  const [source, setSource] = React.useState<"degiro" | "binance" | "cobas">(
    "degiro",
  );
  const [accountId, setAccountId] = React.useState<string>(
    accounts[0]?.id ?? "",
  );
  const [csvText, setCsvText] = React.useState<string>("");
  const [fileName, setFileName] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<PreviewPayload | null>(null);
  const [showErrors, setShowErrors] = React.useState(false);
  const [commitResult, setCommitResult] = React.useState<string | null>(null);
  const [cryptoPicks, setCryptoPicks] = React.useState<Record<string, string>>({});

  function reset() {
    setStep("source");
    setCsvText("");
    setFileName("");
    setPreview(null);
    setError(null);
    setCommitResult(null);
    setShowErrors(false);
    setCryptoPicks({});
  }

  async function handleFile(file: File) {
    const text = await file.text();
    setCsvText(text);
    setFileName(file.name);
  }

  async function runPreview() {
    if (!csvText || !accountId) return;
    setLoading(true);
    setError(null);
    const res = await previewImport({ source, accountId, csvText });
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setPreview(res.data);
    // Seed picks with the top candidate per group so the default path is one-click.
    const seed: Record<string, string> = {};
    for (const group of res.data.cryptoCandidates) {
      if (group.candidates.length > 0) seed[group.symbolKey] = group.candidates[0].id;
    }
    setCryptoPicks(seed);
    setStep("preview");
  }

  async function runConfirm() {
    if (!preview) return;
    setLoading(true);
    setError(null);
    const cryptoProviderOverrides: Record<string, string> = {};
    for (const [k, v] of Object.entries(cryptoPicks)) {
      const trimmed = v?.trim();
      if (trimmed) cryptoProviderOverrides[k] = trimmed;
    }
    const res = await confirmImport({
      source,
      accountId,
      csvText,
      ...(Object.keys(cryptoProviderOverrides).length > 0
        ? { cryptoProviderOverrides }
        : {}),
    });
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setCommitResult(
      `${res.data.inserted} inserted (${res.data.insertedTrades} trades, ${res.data.insertedCashMovements} cash), ` +
        `${res.data.skippedDuplicates} duplicates, ${res.data.createdAssets} new assets.`,
    );
    setStep("done");
  }

  const footer = (() => {
    if (step === "source") {
      return (
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={runPreview}
            disabled={!csvText || !accountId || loading}
          >
            {loading ? "Parsing…" : "Preview"}
          </Button>
        </>
      );
    }
    if (step === "preview") {
      return (
        <>
          <Button variant="ghost" onClick={() => setStep("source")}>
            Back
          </Button>
          <Button
            onClick={runConfirm}
            disabled={loading || !preview || preview.counts.new + preview.counts.needsAssetCreation === 0}
          >
            {loading ? "Committing…" : "Confirm import"}
          </Button>
        </>
      );
    }
    return (
      <Button
        onClick={() => {
          onOpenChange(false);
          reset();
        }}
      >
        Close
      </Button>
    );
  })();

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      title="Import CSV"
      description="DEGIRO, Binance, or Cobas — three-step flow."
      footer={footer}
      className="max-w-3xl"
    >
      {step === "source" && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Source</span>
            <select
              value={source}
              onChange={(e) =>
                setSource(e.target.value as "degiro" | "binance" | "cobas")
              }
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="degiro">DEGIRO</option>
              <option value="binance">Binance</option>
              <option value="cobas">Cobas</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Target account</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            >
              {accounts.length === 0 && (
                <option value="">No accounts — create one first</option>
              )}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
              className="text-sm"
            />
            {fileName && (
              <span className="text-xs text-muted-foreground">
                Loaded: {fileName}
              </span>
            )}
          </label>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
      )}

      {step === "preview" && preview && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="success">{preview.counts.new} new</Badge>
            <Badge variant="warning">
              {preview.counts.needsAssetCreation} new asset
            </Badge>
            <Badge variant="neutral">
              {preview.counts.duplicate} duplicate
            </Badge>
            {preview.counts.errors > 0 && (
              <Badge variant="danger">{preview.counts.errors} errors</Badge>
            )}
          </div>
          {preview.cryptoCandidates.length > 0 && (
            <div className="rounded-md border border-border">
              <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Map each new crypto asset to its CoinGecko coin so prices can
                sync. The top result is pre-selected.
              </div>
              <ul className="divide-y divide-border">
                {preview.cryptoCandidates.map((group) => (
                  <li
                    key={group.symbolKey}
                    className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-xs">{group.symbol}</span>
                    {group.error ? (
                      <span className="text-xs text-destructive">
                        Lookup failed: {group.error}
                      </span>
                    ) : group.candidates.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        No CoinGecko match — set providerSymbol manually in
                        /assets after import.
                      </span>
                    ) : (
                      <select
                        value={cryptoPicks[group.symbolKey] ?? ""}
                        onChange={(e) =>
                          setCryptoPicks((prev) => ({
                            ...prev,
                            [group.symbolKey]: e.target.value,
                          }))
                        }
                        className="h-8 min-w-[16rem] rounded-md border border-border bg-background px-2 text-sm"
                      >
                        <option value="">Skip — set manually later</option>
                        {group.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.symbol}) — {c.id}
                            {c.marketCapRank != null
                              ? ` · rank #${c.marketCapRank}`
                              : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {loading ? (
            <StatesBlock mode="loading" />
          ) : (
            <div className="max-h-[40vh] overflow-y-auto">
              <DataTable<PreviewRow>
                rows={preview.rows}
                getRowKey={(r) => `${r.index}-${r.rowFingerprint}`}
                columns={[
                  {
                    key: "date",
                    header: "Date",
                    cell: (r) => r.tradeDate,
                  },
                  {
                    key: "label",
                    header: "Row",
                    cell: (r) => rowLabel(r),
                  },
                  {
                    key: "amount",
                    header: "Amount",
                    align: "right",
                    cell: (r) => {
                      if (r.kind === "trade" && r.priceNative != null && r.quantity != null) {
                        return (
                          <SensitiveValue>
                            {formatMoney(
                              r.quantity * r.priceNative,
                              r.currency,
                            )}
                          </SensitiveValue>
                        );
                      }
                      if (r.kind === "cash_movement" && r.amountNative != null) {
                        return (
                          <SensitiveValue>
                            {formatMoney(r.amountNative, r.currency)}
                          </SensitiveValue>
                        );
                      }
                      return null;
                    },
                  },
                  {
                    key: "status",
                    header: "Status",
                    cell: (r) => statusBadge(r.status),
                  },
                ]}
              />
            </div>
          )}
          {preview.errors.length > 0 && (
            <div className="rounded-md border border-border">
              <button
                type="button"
                onClick={() => setShowErrors((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  {preview.errors.length} parse errors
                </span>
                <span className="text-xs text-muted-foreground">
                  {showErrors ? "Hide" : "Show"}
                </span>
              </button>
              {showErrors && (
                <ul className="divide-y divide-border border-t border-border text-xs">
                  {preview.errors.map((e, i) => (
                    <li key={i} className="px-3 py-2">
                      Row {e.rowIndex}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
      )}

      {step === "done" && commitResult && (
        <div className="flex flex-col gap-2 text-sm">
          <p>{commitResult}</p>
        </div>
      )}
    </Modal>
  );
}

export function ImportWizardButton({ accounts }: { accounts: AccountOption[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        New import
      </Button>
      <ImportWizard open={open} onOpenChange={setOpen} accounts={accounts} />
    </>
  );
}
