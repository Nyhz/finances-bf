"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { createDividend } from "@/src/actions/createDividend";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: { id: string; name: string }[];
  assets: { id: string; name: string }[];
};

type FormState = {
  accountId: string;
  assetId: string;
  tradeDate: string;
  grossNative: string;
  currency: string;
  fxRateToEur: string;
  withholdingOrigenNative: string;
  withholdingDestinoEur: string;
  sourceCountry: string;
  notes: string;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function CreateDividendModal({ open, onOpenChange, accounts, assets }: Props) {
  const initial = React.useMemo<FormState>(
    () => ({
      accountId: accounts[0]?.id ?? "",
      assetId: assets[0]?.id ?? "",
      tradeDate: todayIso(),
      grossNative: "",
      currency: "EUR",
      fxRateToEur: "",
      withholdingOrigenNative: "",
      withholdingDestinoEur: "",
      sourceCountry: "",
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

  const needsFx = form.currency !== "EUR";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);
    setFieldErrors({});

    const fxRate = form.fxRateToEur.trim();
    const sourceCountry = form.sourceCountry.trim().toUpperCase();
    const payload = {
      accountId: form.accountId,
      assetId: form.assetId,
      tradeDate: form.tradeDate,
      grossNative: Number(form.grossNative),
      currency: form.currency.toUpperCase(),
      fxRateToEur: fxRate ? Number(fxRate) : undefined,
      withholdingOrigenNative: form.withholdingOrigenNative
        ? Number(form.withholdingOrigenNative)
        : 0,
      withholdingDestinoEur: form.withholdingDestinoEur
        ? Number(form.withholdingDestinoEur)
        : 0,
      sourceCountry: sourceCountry.length === 2 ? sourceCountry : undefined,
      notes: form.notes.trim() || undefined,
    };

    startTransition(async () => {
      const result = await createDividend(payload);
      if (result.ok) {
        handleOpenChange(false);
        return;
      }
      setBanner(result.error.message);
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Record dividend"
      description="Gross dividend received from a held asset, net of withholding taxes."
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
            onChange={(e) => update("assetId", e.target.value)}
            className={inputClass}
            required
          >
            {assets.length === 0 && <option value="">No assets</option>}
            {assets.map((a) => (
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
          <Field label="Gross amount (native)" errors={fieldErrors.grossNative}>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.grossNative}
              onChange={(e) => update("grossNative", e.target.value)}
              className={inputClass}
              required
            />
          </Field>

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
        </div>

        {needsFx && (
          <Field label="FX rate to EUR" errors={fieldErrors.fxRateToEur}>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.fxRateToEur}
              onChange={(e) => update("fxRateToEur", e.target.value)}
              className={inputClass}
              placeholder="Leave blank to use the stored rate"
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Withholding origen (native)"
            errors={fieldErrors.withholdingOrigenNative}
          >
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.withholdingOrigenNative}
              onChange={(e) => update("withholdingOrigenNative", e.target.value)}
              className={inputClass}
              placeholder="0"
            />
          </Field>

          <Field
            label="Withholding destino (EUR)"
            errors={fieldErrors.withholdingDestinoEur}
          >
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={form.withholdingDestinoEur}
              onChange={(e) => update("withholdingDestinoEur", e.target.value)}
              className={inputClass}
              placeholder="0"
            />
          </Field>
        </div>

        <Field label="Source country (optional, ISO-2)" errors={fieldErrors.sourceCountry}>
          <input
            type="text"
            value={form.sourceCountry}
            onChange={(e) => update("sourceCountry", e.target.value.toUpperCase())}
            className={inputClass}
            maxLength={2}
            placeholder="e.g. US"
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
              pending || !form.accountId || !form.assetId || !form.grossNative || !form.currency
            }
          >
            {pending ? "Saving…" : "Record dividend"}
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
