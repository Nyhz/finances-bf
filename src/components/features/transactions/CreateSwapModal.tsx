"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { createSwap } from "@/src/actions/createSwap";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: { id: string; name: string }[];
  assets: { id: string; name: string }[];
};

type FormState = {
  accountId: string;
  tradeDate: string;
  outgoingAssetId: string;
  outgoingQuantity: string;
  incomingAssetId: string;
  incomingQuantity: string;
  valueEur: string;
  notes: string;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function CreateSwapModal({ open, onOpenChange, accounts, assets }: Props) {
  const initial = React.useMemo<FormState>(
    () => ({
      accountId: accounts[0]?.id ?? "",
      tradeDate: todayIso(),
      outgoingAssetId: assets[0]?.id ?? "",
      outgoingQuantity: "",
      incomingAssetId: assets[1]?.id ?? assets[0]?.id ?? "",
      incomingQuantity: "",
      valueEur: "",
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

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);
    setFieldErrors({});

    const payload = {
      accountId: form.accountId,
      tradeDate: form.tradeDate,
      outgoingAssetId: form.outgoingAssetId,
      outgoingQuantity: Number(form.outgoingQuantity),
      incomingAssetId: form.incomingAssetId,
      incomingQuantity: Number(form.incomingQuantity),
      valueEur: Number(form.valueEur),
      notes: form.notes.trim() || undefined,
    };

    startTransition(async () => {
      const result = await createSwap(payload);
      if (result.ok) {
        handleOpenChange(false);
        return;
      }
      if (result.error.code === "validation") {
        setBanner(result.error.message);
      } else {
        setBanner(result.error.message);
      }
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Record crypto swap"
      description="Two linked transactions: sell the outgoing asset, buy the incoming asset."
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

        <Field label="Date" errors={fieldErrors.tradeDate}>
          <input
            type="date"
            value={form.tradeDate}
            onChange={(e) => update("tradeDate", e.target.value)}
            className={inputClass}
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Outgoing asset" errors={fieldErrors.outgoingAssetId}>
            <select
              value={form.outgoingAssetId}
              onChange={(e) => update("outgoingAssetId", e.target.value)}
              className={inputClass}
              required
            >
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Outgoing quantity" errors={fieldErrors.outgoingQuantity}>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.outgoingQuantity}
              onChange={(e) => update("outgoingQuantity", e.target.value)}
              className={inputClass}
              required
            />
          </Field>

          <Field label="Incoming asset" errors={fieldErrors.incomingAssetId}>
            <select
              value={form.incomingAssetId}
              onChange={(e) => update("incomingAssetId", e.target.value)}
              className={inputClass}
              required
            >
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Incoming quantity" errors={fieldErrors.incomingQuantity}>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.incomingQuantity}
              onChange={(e) => update("incomingQuantity", e.target.value)}
              className={inputClass}
              required
            />
          </Field>
        </div>

        <Field label="EUR value at swap" errors={fieldErrors.valueEur}>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={form.valueEur}
            onChange={(e) => update("valueEur", e.target.value)}
            className={inputClass}
            required
          />
        </Field>

        <Field label="Notes (optional)" errors={fieldErrors.notes}>
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
          <Button
            type="submit"
            disabled={
              pending ||
              !form.accountId ||
              !form.outgoingAssetId ||
              !form.incomingAssetId ||
              !form.outgoingQuantity ||
              !form.incomingQuantity ||
              !form.valueEur
            }
          >
            {pending ? "Saving…" : "Record swap"}
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
