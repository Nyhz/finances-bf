import { KPICard } from "@/src/components/ui/KPICard";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { TaxReport } from "@/src/server/tax/report";

export function TaxKpiRow({ report, interestEur }: { report: TaxReport; interestEur: number }) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      <KPICard label="Realized gains" value={<SensitiveValue>{formatEur(report.totals.realizedGainsEur)}</SensitiveValue>} />
      <KPICard label="Realized losses (computable)" value={<SensitiveValue>{formatEur(report.totals.realizedLossesComputableEur)}</SensitiveValue>} />
      <KPICard label="Non-computable losses (art. 33.5)" value={<SensitiveValue>{formatEur(report.totals.nonComputableLossesEur)}</SensitiveValue>} />
      <KPICard label="Net computable" value={<SensitiveValue>{formatEur(report.totals.netComputableEur)}</SensitiveValue>} />
      <KPICard label="Dividends gross" value={<SensitiveValue>{formatEur(report.totals.dividendsGrossEur)}</SensitiveValue>} />
      <KPICard label="Retención (origen)" value={<SensitiveValue>{formatEur(report.totals.withholdingOrigenTotalEur)}</SensitiveValue>} />
      <KPICard label="Interest (informational · Modelo 196)" value={<SensitiveValue>{formatEur(interestEur)}</SensitiveValue>} />
    </section>
  );
}
