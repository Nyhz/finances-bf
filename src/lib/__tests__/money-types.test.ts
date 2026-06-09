import { describe, expect, it } from "vitest";
import { marketEur, txEur, unbrand } from "../money-types";
import type { MarketEur, TxEur } from "../money-types";

// Audit T8 / test R-4: the provenance wall is a compiler guarantee. The
// expect-error directives below are validated by `pnpm typecheck` — if the
// brands ever stop being nominal, typecheck fails because the expected
// errors disappear.
describe("branded money types", () => {
  it("brands are erased at runtime", () => {
    expect(txEur(12.34)).toBe(12.34);
    expect(marketEur(56.78)).toBe(56.78);
    expect(unbrand(txEur(1))).toBe(1);
  });

  it("market values cannot flow into transaction-money slots (compile-time)", () => {
    const market: MarketEur = marketEur(100);
    const tx: TxEur = txEur(100);

    // @ts-expect-error a MarketEur must not be assignable to TxEur
    const leak1: TxEur = market;
    // @ts-expect-error a TxEur must not be assignable to MarketEur
    const leak2: MarketEur = tx;
    // @ts-expect-error a bare number must not be assignable to TxEur
    const leak3: TxEur = 100;
    // @ts-expect-error a bare number must not be assignable to MarketEur
    const leak4: MarketEur = 100;

    // Both still flow into plain-number consumers (display/format layers).
    const fmt = (n: number) => n.toFixed(2);
    expect(fmt(market)).toBe("100.00");
    expect(fmt(tx)).toBe("100.00");
    void leak1; void leak2; void leak3; void leak4;
  });
});
