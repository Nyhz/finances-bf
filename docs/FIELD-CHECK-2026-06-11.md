# Field Check — 2026-06-11

Revisión multi-agente (6 dimensiones × revisor + verificación adversarial por
hallazgo; 70 agentes). Resultado bruto: 60 hallazgos confirmados, 4 refutados.
Los confirmados de severidad alta y los quirúrgicos de media se corrigieron en
la misma pasada; lo que queda aquí es lo **diferido deliberadamente**, con el
porqué. Estado tras la pasada: typecheck/lint/build verdes, 262 tests (24
nuevos), smoke OK contra el servicio en :3200.

## Corregido en esta pasada (resumen)

- **Dinero/integridad**: movimiento de caja pareado del dividendo ya no se
  duplica en el ledger ni es borrable por separado; `rowFingerprint` en swaps y
  dividendos (con `allowDuplicate`); todo redondeo EUR via `roundEur` (4 sitios
  inline divergían en el medio céntimo); coste base de overview desde
  `totalCostEur` (ya no `qty × averageCost` prerredondeado); `unsealYear`
  audita el payload completo; `wipeApp` deja evento terminal con recuentos;
  `createAccount` resuelve FX vía `resolveFxRateSync`; refine anti
  swap-mismo-activo; sentinel `tax-lots:` mapeado a español en delete.
- **M720/M721**: umbral 50 k€ conjunto por categoría (no por país); los bloques
  previos sub-umbral ya no envenenan `lastDeclaredEur` (flag `declared` con
  fallback por status); saldos sin país → bloque centinela `??` con gate de
  acknowledgement en el sellado; payloads antiguos siguen parseando.
- **UI**: 5 fugas de `<SensitiveValue>` selladas (tooltips NetWorth/Savings/
  AccountPerformance, diff de auditoría, columna Precio) + ejes monetarios con
  clase `sensitive`; locale unificado a es-ES en `lib/format.ts` y todos los
  charts; mapas de etiquetas consolidados en `src/lib/labels.ts` (5 copias de
  account-types con un tipo fantasma `bank`, transfer-in/out que filtraban
  inglés); PDF de extracto de cuenta y XLSX traducidos; `lang="es"`; banner de
  sello corrupto en español.
- **Estructura**: constantes de dominio en `src/lib/domain.ts` (la capa de
  lectura ya no importa de `actions/`); `server/mutations.ts` → `rebuild.ts`;
  tipo `Tx`/`DbOrTx` canónico en `db/client.ts` (6 copias fuera); deps Radix
  muertas eliminadas; `statement.csv` movido a `data/`; KPI overview ya no
  construye un tax report completo para un campo que nadie renderiza;
  `getNetWorthSeries` deduplicado con `cache()`; código muerto de overview y
  `sumValuationsEur` eliminados; CLAUDE.md/SPEC.md ya no legislan sobre los
  importadores borrados.

## Accionables diferidos

### P1 — decisión del Commander o cirugía mayor

1. **`withServerAction` wrapper** (backlog #1). 17 actions repiten
   validación/tx/audit/catch y el protocolo sentinel-inglés→regex→español es
   frágil. Hacerlo con clases de error tipadas (como `FxDeviationError`).
   Migrar 2-3 actions primero. ~400 LoC menos y elimina la clase de bug
   "action sin audit event".
2. **Previsión foral — wash sale con coeficientes** (`prevision.ts:41-76`).
   (a) La disallowance se re-aplica con el importe histórico en vez del ratio
   `absorbingQty/soldQty` sobre la pérdida foral; (b) la pérdida diferida
   integrada en el valor de adquisición se multiplica por el coeficiente del
   lote absorbente. Ambos distorsionan la estimación (no la Declaración).
   Requiere criterio fiscal antes de tocar.
3. **M720 — pata de efectivo extranjero**. El cash de cuentas extranjeras
   nunca llega a los bloques `bank-accounts` (solo se agregan posiciones).
   Decidir si entra en alcance; si no, documentarlo como exclusión explícita.
4. **Drift post-sellado incompleto** (`seals.ts`). El hash no cubre
   withholding destino, ni interest, ni los bloques M720. Extenderlo
   **invalida el `contentHash` de sellos existentes** → necesita versión de
   hash o re-sellado consciente. No tocar sin plan de migración.
5. **Interés sin retención** (`interest.ts` + `createCashMovement`). El RCM
   asume bruto pero la banca abona neto del 19 %. Añadir campo de retención
   opcional al movimiento `interest` o documentar la convención asumida.

### P2 — UI / primitivas

6. Extraer `useManualFx()` + `<FxRateField>`: el flujo FX manual está
   triplicado en los tres modales grandes (>370 líneas cada uno).
7. `DataTable`: añadir fila expandible + slot de totales y migrar las 5 tablas
   que lo esquivan (GainsTable, DeclarationTable, DividendsTable,
   GainsLotDetail, AuditTable — esta última copia los estilos a mano).
8. Botones crudos → variante `chip`/`SegmentedControl` de `Button`
   (OverviewFilters ×3, expander de GainsTable, `<a>` de AccountHeader →
   `<Button asChild>`).
9. `ExportMenu` genérico sobre Radix DropdownMenu (las 2 copias actuales no
   cierran con Escape/click-fuera ni tienen ARIA de menú).
10. `loading.tsx` por ruta para /transactions, /accounts, /assets, /audit,
    /taxes/[year] reutilizando los skeletons existentes.
11. Expansión de filas de AuditTable accesible por teclado (botón real con
    `aria-expanded`, como ya hace GainsTable).

### P3 — pulido / oportunista

12. `recomputeAssetPosition` mezcla unidades en `totalCostNative` cuando un
    swap toca un activo no-EUR (las patas se guardan EUR con rate 1). Decidir:
    pool nativo null para posiciones de procedencia mixta, o derivar con un
    rate del activo. El pool EUR es correcto; solo afecta a columnas native.
13. Semántica de `feesAmount` (siempre EUR aunque ocupa la posición "native").
    Documentar en el schema o renombrar con migración.
14. DDI calculado sobre el tramo exento de 1.500 € (`cuota.ts:148-152`) —
    sobreestima el crédito hasta ~225 €. Escalar la base por la fracción no
    exenta o documentar la aproximación.
15. N+1 de valoraciones restantes en `overview.ts` (3 bucles per-asset) —
    espejar `latestValuationsFor` de `positions.ts`. Urgencia baja tras quitar
    el tax report del KPI.
16. Sparkline de top posiciones sin downsampling en rango ALL (payload RSC
    completo por posición) — presupuesto fijo de ~100 puntos.
17. Cron price-sync estrictamente secuencial — concurrencia acotada (4-5) y
    transacción única en los upserts de la fase de valoraciones.
18. Unificar convención de tests (hoy conviven 4 layouts).

## Refutados por la verificación (no tocar)

- Mutaciones en años sellados sin guard de escritura: **diseño deliberado**
  (drift banner + contentHash); un guard same-year daría falsa cobertura
  porque FIFO cruza ejercicios.
- Coste/PnL de grupos del statement con líneas sin valorar: semántica
  idéntica a los totales, intencional y divulgada con «—».
- `actions/accounts.ts` con schema inline: sigue la convención escrita en
  SPEC §7 (un fichero por agregado); los `.schema.ts` existen para los tests.
- Tiempo de import de vitest (~12 s acumulados): contabilidad estándar de
  workers paralelos; wall-clock 3 s.
