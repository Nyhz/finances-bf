"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { createTransaction } from "@/src/actions/createTransaction";

export type AccountOption = { id: string; name: string; currency: string };
export type AssetOption = { id: string; name: string; symbol: string | null; currency: string };

type FormState = {
  accountId: string;
  assetId: string;
  tradeDate: string;
  side: "buy" | "sell";
  quantity: string;
  priceNative: string;
  currency: string;
  fees: string;
  notes: string;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function CreateTransactionModal({
  open,
  onOpenChange,
  accounts,
  assets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: AccountOption[];
  assets: AssetOption[];
}) {
  const initial = React.useMemo<FormState>(
    () => ({
      accountId: accounts[0]?.id ?? "",
      assetId: assets[0]?.id ?? "",
      tradeDate: todayIso(),
      side: "buy",
      quantity: "",
      priceNative: "",
      currency: assets[0]?.currency ?? "EUR",
      fees: "0",
      notes: "",
    }),
    [accounts, assets],
  );

  const [form, setForm] = React.useState<FormState>(initial);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function handleOpenChange(next: boolean) {
    if (!next && !pending) {
      setForm(initial);
      setFieldErrors({});
      setBanner(null);
    }
    onOpenChange(next);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onAssetChange(id: string) {
    const asset = assets.find((a) => a.id === id);
    setForm((prev) => ({
      ...prev,
      assetId: id,
      currency: asset?.currency ?? prev.currency,
    }));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);
    setFieldErrors({});

    const payload = {
      accountId: form.accountId,
      assetId: form.assetId,
      tradeDate: form.tradeDate,
      side: form.side,
      quantity: Number(form.quantity),
      priceNative: Number(form.priceNative),
      currency: form.currency.toUpperCase(),
      fees: Number(form.fees || 0),
      notes: form.notes.trim() ? form.notes : undefined,
    };

    startTransition(async () => {
      const result = await createTransaction(payload);
      if (result.ok) {
        handleOpenChange(false);
        return;
      }
      if (result.error.code === "validation" && result.error.fieldErrors) {
        setFieldErrors(result.error.fieldErrors);
      } else {
        setBanner(result.error.message);
      }
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="New transaction"
      description="Record a buy or sell. Position and cash balance update together."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {banner && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {banner}
          </div>
        )}

        <Field label="Account" errors={fieldErrors.accountId}>
          <select
            value={form.accountId}
            onChange={(e) => update("accountId", e.target.value)}
            className={inputClass}
            required
          >
            {accounts.length === 0 && <option value="">No accounts</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Asset" errors={fieldErrors.assetId}>
          <select
            value={form.assetId}
            onChange={(e) => onAssetChange(e.target.value)}
            className={inputClass}
            required
          >
            {assets.length === 0 && <option value="">No assets</option>}
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.symbol ?? a.name} — {a.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Side" errors={fieldErrors.side}>
          <select
            value={form.side}
            onChange={(e) => update("side", e.target.value as "buy" | "sell")}
            className={inputClass}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </Field>

        <Field label="Trade date" errors={fieldErrors.tradeDate}>
          <input
            type="date"
            value={form.tradeDate}
            onChange={(e) => update("tradeDate", e.target.value)}
            className={inputClass}
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" errors={fieldErrors.quantity}>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.quantity}
              onChange={(e) => update("quantity", e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Unit price" errors={fieldErrors.priceNative}>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.priceNative}
              onChange={(e) => update("priceNative", e.target.value)}
              className={inputClass}
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency" errors={fieldErrors.currency}>
            <input
              type="text"
              value={form.currency}
              onChange={(e) => update("currency", e.target.value.toUpperCase())}
              className={inputClass}
              maxLength={3}
              required
            />
          </Field>
          <Field label="Fees" errors={fieldErrors.fees}>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.fees}
              onChange={(e) => update("fees", e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Notes" errors={fieldErrors.notes}>
          <textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            className={`${inputClass} min-h-[60px]`}
            maxLength={500}
          />
        </Field>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !form.accountId || !form.assetId}>
            {pending ? "Saving…" : "Create transaction"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

function Field({
  label,
  errors,
  children,
}: {
  label: string;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {errors && errors.length > 0 && (
        <span className="text-xs text-destructive">{errors.join(", ")}</span>
      )}
    </label>
  );
}
