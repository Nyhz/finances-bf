import Link from "next/link";
import { ExportMenu } from "./ExportMenu";
import { SealYearButton } from "./SealYearButton";
import { UnsealYearButton } from "./UnsealYearButton";

type Props = {
  year: number;
  availableYears: number[];
  sealed: boolean;
  /** Foreign M720/M721 blocks contain unvalued positions — sealing needs an explicit acknowledgement. */
  hasUnvalued?: boolean;
  /** M720/M721 blocks contain balances from accounts without country — same explicit gate. */
  hasUnknownCountry?: boolean;
};

export function TaxesHeader({
  year,
  availableYears,
  sealed,
  hasUnvalued = false,
  hasUnknownCountry = false,
}: Props) {
  const years = [...new Set([year, ...availableYears])].sort((a, b) => b - a);
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fiscalidad {year}</h1>
        <p className="text-sm text-muted-foreground">
          Declaración: las cifras a teclear en Rentanet. Previsión: lo que saldrá.
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
        {sealed ? (
          <UnsealYearButton year={year} />
        ) : (
          <SealYearButton
            year={year}
            hasUnvalued={hasUnvalued}
            hasUnknownCountry={hasUnknownCountry}
          />
        )}
        <ExportMenu year={year} />
      </div>
    </header>
  );
}
