/**
 * Coeficientes de actualización del valor de adquisición — art. 45.Dos
 * NF 13/2013 (IRPF Bizkaia). A diferencia del territorio común (suprimidos en
 * 2015), Bizkaia actualiza el valor de adquisición de TODOS los elementos
 * patrimoniales con la tabla aprobada cada diciembre por Decreto Foral.
 *
 * Tablas IRPF (artículo 1 de cada decreto — la tabla de IS del mismo decreto
 * es distinta, no confundir):
 *  - Transmisiones 2025: DF 125/2024, de 5 de diciembre (BOB 16-dic-2024).
 *  - Transmisiones 2026: DF 115/2025, de 4 de diciembre (BOB 15-dic-2025).
 *
 * Estos coeficientes alimentan EXCLUSIVAMENTE la sección Previsión: la
 * Declaración transcribe valores históricos sin actualizar (Rentanet aplica
 * el coeficiente por su cuenta al introducir las fechas).
 */

type CoefficientTable = {
  /** Acquisitions in this year or earlier use `floorCoefficient`. */
  floorYear: number;
  floorCoefficient: number;
  byYear: Record<number, number>;
};

const TABLES: Record<number, CoefficientTable> = {
  // DF 125/2024 — transmissions during 2025.
  2025: {
    floorYear: 1994,
    floorCoefficient: 1.969,
    byYear: {
      1995: 2.091, 1996: 2.014, 1997: 1.969, 1998: 1.925, 1999: 1.873,
      2000: 1.809, 2001: 1.742, 2002: 1.68, 2003: 1.634, 2004: 1.586,
      2005: 1.536, 2006: 1.485, 2007: 1.444, 2008: 1.387, 2009: 1.383,
      2010: 1.36, 2011: 1.319, 2012: 1.29, 2013: 1.27, 2014: 1.268,
      2015: 1.268, 2016: 1.267, 2017: 1.243, 2018: 1.223, 2019: 1.212,
      2020: 1.212, 2021: 1.175, 2022: 1.088, 2023: 1.05, 2024: 1.018,
      2025: 1.0,
    },
  },
  // DF 115/2025 — transmissions during 2026.
  2026: {
    floorYear: 1994,
    floorCoefficient: 2.03,
    byYear: {
      1995: 2.156, 1996: 2.076, 1997: 2.03, 1998: 1.985, 1999: 1.931,
      2000: 1.866, 2001: 1.796, 2002: 1.732, 2003: 1.685, 2004: 1.635,
      2005: 1.583, 2006: 1.531, 2007: 1.489, 2008: 1.43, 2009: 1.426,
      2010: 1.402, 2011: 1.36, 2012: 1.33, 2013: 1.309, 2014: 1.307,
      2015: 1.307, 2016: 1.307, 2017: 1.281, 2018: 1.261, 2019: 1.249,
      2020: 1.249, 2021: 1.212, 2022: 1.121, 2023: 1.082, 2024: 1.05,
      2025: 1.02, 2026: 1.0,
    },
  },
};

/** Years with a published IRPF table. */
export function coefficientTableYears(): number[] {
  return Object.keys(TABLES).map(Number).sort();
}

/**
 * Coefficient applicable to an acquisition made in `acquisitionYear` for a
 * transmission made in `transmissionYear`. Returns null when no table is
 * published for the transmission year — callers must surface that, never
 * silently default to 1.
 */
export function actualizationCoefficient(
  transmissionYear: number,
  acquisitionYear: number,
): number | null {
  const table = TABLES[transmissionYear];
  if (!table) return null;
  if (acquisitionYear <= table.floorYear) return table.floorCoefficient;
  // Same-year (or later — defensive) acquisitions are never below 1.0.
  return table.byYear[acquisitionYear] ?? 1.0;
}
