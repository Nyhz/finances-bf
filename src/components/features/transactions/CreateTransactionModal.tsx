"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { createTransaction } from "@/src/actions/createTransaction";
import { previewFx, type FxPreview } from "@/src/actions/previewFx";
import { formatEur } from "@/src/lib/format";

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
  fxRateToEur: string;
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
      fxRateToEur: "",
      fees: "0",
      notes: "",
    }),
    [accounts, assets],
  );

  const [form, setForm] = React.useState<FormState>(initial);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = React.useState(false);
  const [fxDeviationWarning, setFxDeviationWarning] = React.useState(false);
  const [fxPreview, setFxPreview] = React.useState<FxPreview | null>(null);
  const [fxUnavailable, setFxUnavailable] = React.useState(false);
  // Sticky per-form acknowledgements so confirming one warning survives a
  // second round-trip (e.g. FX override confirmed, then duplicate confirmed).
  const acceptedRef = React.useRef({ duplicate: false, fxDeviation: false });
  const [pending, startTransition] = React.useTransition();

  function handleOpenChange(next: boolean) {
    if (!next && !pending) {
      setForm(initial);
      setFieldErrors({});
      setBanner(null);
      setDuplicateWarning(false);
      setFxDeviationWarning(false);
      acceptedRef.current = { duplicate: false, fxDeviation: false };
    }
    onOpenChange(next);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Inputs that change which FX rate applies invalidate the live preview.
    if (key === "currency" || key === "tradeDate") {
      setFxPreview(null);
      setFxUnavailable(false);
    }
  }

  function onAssetChange(id: string) {
    const asset = assets.find((a) => a.id === id);
    setForm((prev) => ({
      ...prev,
      assetId: id,
      currency: asset?.currency ?? prev.currency,
    }));
    setFxPreview(null);
    setFxUnavailable(false);
  }

  // Audit H3: show the rate that WILL be applied (and its provenance) before
  // the user submits — money is never entered blind.
  React.useEffect(() => {
    if (!open || form.currency === "EUR" || !/^\d{4}-\d{2}-\d{2}$/.test(form.tradeDate)) {
      return;
    }
    let cancelled = false;
    previewFx({ currency: form.currency, date: form.tradeDate }).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setFxPreview(res.data);
        setFxUnavailable(false);
      } else {
        setFxPreview(null);
        setFxUnavailable(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, form.currency, form.tradeDate]);

  const manualRate = form.fxRateToEur.trim() ? Number(form.fxRateToEur) : undefined;
  const effectiveRate =
    form.currency === "EUR" ? 1 : (manualRate ?? fxPreview?.rate);
  const qtyNum = Number(form.quantity);
  const priceNum = Number(form.priceNative);
  const feesNum = Number(form.fees || 0);
  const estimatedTotalEur =
    effectiveRate != null &&
    Number.isFinite(effectiveRate) &&
    effectiveRate > 0 &&
    qtyNum > 0 &&
    priceNum > 0
      ? (qtyNum * priceNum + (form.side === "buy" ? feesNum : -feesNum)) * effectiveRate
      : null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submit();
  }

  function submit(extra?: { allowDuplicate?: boolean; allowFxDeviation?: boolean }) {
    setBanner(null);
    setFieldErrors({});
    if (extra?.allowDuplicate) acceptedRef.current.duplicate = true;
    if (extra?.allowFxDeviation) acceptedRef.current.fxDeviation = true;

    const payload = {
      accountId: form.accountId,
      assetId: form.assetId,
      tradeDate: form.tradeDate,
      side: form.side,
      quantity: Number(form.quantity),
      priceNative: Number(form.priceNative),
      currency: form.currency.toUpperCase(),
      fxRateToEur: form.fxRateToEur.trim() ? Number(form.fxRateToEur) : undefined,
      fees: Number(form.fees || 0),
      notes: form.notes.trim() ? form.notes : undefined,
      allowDuplicate: acceptedRef.current.duplicate,
      allowFxDeviation: acceptedRef.current.fxDeviation,
    };

    startTransition(async () => {
      const result = await createTransaction(payload);
      if (result.ok) {
        handleOpenChange(false);
        return;
      }
      if (result.error.code === "duplicate") {
        setDuplicateWarning(true);
        setBanner(result.error.message);
        return;
      }
      if (result.error.code === "fx_deviation") {
        setFxDeviationWarning(true);
        setBanner(result.error.message);
        if (result.error.fieldErrors) setFieldErrors(result.error.fieldErrors);
        return;
      }
      setDuplicateWarning(false);
      setFxDeviationWarning(false);
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
              readOnly
              aria-readonly="true"
              tabIndex={-1}
              className={`${inputClass} cursor-not-allowed bg-muted/40 text-muted-foreground`}
            />
            <span className="text-xs text-muted-foreground">
              Derived from the selected asset — the unit price is always in this currency.
            </span>
          </Field>
          <Field label={`Fees (${form.currency})`} errors={fieldErrors.fees}>
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

        {form.currency !== "EUR" && (
          <Field
            label={`FX rate — 1 ${form.currency} = ? EUR (optional)`}
            errors={fieldErrors.fxRateToEur}
          >
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder={
                fxPreview
                  ? `Leave blank to use ${fxPreview.rate.toFixed(6)}`
                  : "Leave blank to use the stored daily rate"
              }
              value={form.fxRateToEur}
              onChange={(e) => update("fxRateToEur", e.target.value)}
              className={inputClass}
            />
            {fxPreview && (
              <span className="text-xs text-muted-foreground">
                Stored rate: 1 {form.currency} = {fxPreview.rate.toFixed(6)} EUR
                {fxPreview.rateDate ? ` (${fxPreview.rateDate})` : ""}
                {fxPreview.stale
                  ? " — stale: no rate for the trade date, most recent earlier rate shown"
                  : ""}
              </span>
            )}
            {fxUnavailable && (
              <span className="text-xs text-destructive">
                No stored rate for this currency/date — enter the broker&apos;s rate
                (how many EUR one {form.currency} is worth).
              </span>
            )}
          </Field>
        )}

        {estimatedTotalEur != null && (
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              Estimated {form.side === "buy" ? "cost incl. fees" : "net proceeds"}
              {manualRate != null ? " (your rate)" : fxPreview?.stale ? " (stale rate)" : ""}
            </span>
            <SensitiveValue>{formatEur(estimatedTotalEur)}</SensitiveValue>
          </div>
        )}

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
          {duplicateWarning ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => submit({ allowDuplicate: true })}
            >
              Save anyway
            </Button>
          ) : null}
          {fxDeviationWarning ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => submit({ allowFxDeviation: true })}
            >
              Use my rate anyway
            </Button>
          ) : null}
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
