"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { createDividend } from "@/src/actions/createDividend";
import { previewFx, type FxPreview } from "@/src/actions/previewFx";
import { formatEur } from "@/src/lib/format";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: { id: string; name: string }[];
  assets: { id: string; name: string; currency: string }[];
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

// Currencies dividends are realistically paid in. The selected asset's quote
// currency is always offered (and preselected) on top of these.
const DIVIDEND_CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;

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
      // The payout currency is almost always the asset's quote currency —
      // default to it instead of EUR (audit H4).
      currency: assets[0]?.currency ?? "EUR",
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
  const [fxDeviationWarning, setFxDeviationWarning] = React.useState(false);
  const [fxPreview, setFxPreview] = React.useState<FxPreview | null>(null);
  const [fxUnavailable, setFxUnavailable] = React.useState(false);
  const acceptedFxRef = React.useRef(false);
  const [pending, startTransition] = React.useTransition();

  function handleOpenChange(next: boolean) {
    if (!next && !pending) {
      setForm(initial);
      setFieldErrors({});
      setBanner(null);
      setFxDeviationWarning(false);
      acceptedFxRef.current = false;
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

  const selectedAsset = assets.find((a) => a.id === form.assetId);
  const currencyOptions = Array.from(
    new Set([selectedAsset?.currency ?? "EUR", ...DIVIDEND_CURRENCIES]),
  );
  const needsFx = form.currency !== "EUR";

  // Audit H3: preview the rate that will be applied before submitting.
  React.useEffect(() => {
    if (!open || !needsFx || !/^\d{4}-\d{2}-\d{2}$/.test(form.tradeDate)) {
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
  }, [open, needsFx, form.currency, form.tradeDate]);

  const manualRate = form.fxRateToEur.trim() ? Number(form.fxRateToEur) : undefined;
  const effectiveRate = needsFx ? (manualRate ?? fxPreview?.rate) : 1;
  const grossNum = Number(form.grossNative);
  const whtOrigenNum = Number(form.withholdingOrigenNative || 0);
  const whtDestinoNum = Number(form.withholdingDestinoEur || 0);
  const estimatedNetEur =
    effectiveRate != null && Number.isFinite(effectiveRate) && effectiveRate > 0 && grossNum > 0
      ? (grossNum - whtOrigenNum) * effectiveRate - whtDestinoNum
      : null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submit();
  }

  function submit(extra?: { allowFxDeviation?: boolean }) {
    setBanner(null);
    setFieldErrors({});
    if (extra?.allowFxDeviation) acceptedFxRef.current = true;

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
      allowFxDeviation: acceptedFxRef.current,
    };

    startTransition(async () => {
      const result = await createDividend(payload);
      if (result.ok) {
        handleOpenChange(false);
        return;
      }
      if (result.error.code === "fx_deviation") {
        setFxDeviationWarning(true);
        setBanner(result.error.message);
        if (result.error.fieldErrors) setFieldErrors(result.error.fieldErrors);
        return;
      }
      setFxDeviationWarning(false);
      if (
        (result.error.code === "validation" || result.error.code === "not_found") &&
        result.error.fieldErrors
      ) {
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
            onChange={(e) => onAssetChange(e.target.value)}
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
          <Field label={`Gross amount (${form.currency})`} errors={fieldErrors.grossNative}>
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
            <select
              value={form.currency}
              onChange={(e) => update("currency", e.target.value)}
              className={inputClass}
              required
            >
              {currencyOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {c === selectedAsset?.currency ? " (asset currency)" : ""}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              The currency the payout arrived in — usually the asset&apos;s own.
            </span>
          </Field>
        </div>

        {needsFx && (
          <Field
            label={`FX rate — 1 ${form.currency} = ? EUR (optional)`}
            errors={fieldErrors.fxRateToEur}
          >
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.fxRateToEur}
              onChange={(e) => update("fxRateToEur", e.target.value)}
              className={inputClass}
              placeholder={
                fxPreview
                  ? `Leave blank to use ${fxPreview.rate.toFixed(6)}`
                  : "Leave blank to use the stored rate"
              }
            />
            {fxPreview && (
              <span className="text-xs text-muted-foreground">
                Stored rate: 1 {form.currency} = {fxPreview.rate.toFixed(6)} EUR
                {fxPreview.rateDate ? ` (${fxPreview.rateDate})` : ""}
                {fxPreview.stale
                  ? " — stale: no rate for this date, most recent earlier rate shown"
                  : ""}
              </span>
            )}
            {fxUnavailable && (
              <span className="text-xs text-destructive">
                No stored rate for this currency/date — enter how many EUR one{" "}
                {form.currency} is worth (e.g. 0.92, never the EUR→{form.currency}{" "}
                direction).
              </span>
            )}
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={`Withholding origen (${form.currency})`}
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

        {estimatedNetEur != null && (
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              Estimated net received
              {manualRate != null ? " (your rate)" : fxPreview?.stale ? " (stale rate)" : ""}
            </span>
            <SensitiveValue>{formatEur(estimatedNetEur)}</SensitiveValue>
          </div>
        )}

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
