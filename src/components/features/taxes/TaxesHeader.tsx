import Link from "next/link";
import { ExportMenu } from "./ExportMenu";
import { SealYearButton } from "./SealYearButton";
import { UnsealYearButton } from "./UnsealYearButton";

type Props = {
  year: number;
  availableYears: number[];
  sealed: boolean;
};

export function TaxesHeader({ year, availableYears, sealed }: Props) {
  const years = [...new Set([year, ...availableYears])].sort((a, b) => b - a);
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Taxes — {year}</h1>
        <p className="text-sm text-muted-foreground">
          Realized gains, dividends, informational-model status.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border border-border p-1">
          {years.map((y) => (
            <Link
              key={y}
              href={`/taxes/${y}`}
              className={[
                "rounded-md px-3 py-1 text-sm",
                y === year ? "bg-accent font-medium" : "hover:bg-accent/40",
              ].join(" ")}
            >
              {y}
            </Link>
          ))}
        </div>
        {sealed ? <UnsealYearButton year={year} /> : <SealYearButton year={year} />}
        <ExportMenu year={year} />
      </div>
    </header>
  );
}
