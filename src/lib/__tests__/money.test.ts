import { describe, expect, it } from "vitest";
import { roundEur } from "../money";

describe("roundEur", () => {
  it("rounds to 2dp half-away-from-zero", () => {
    expect(roundEur(1.005)).toBe(1.01);
    expect(roundEur(1.004)).toBe(1.0);
    expect(roundEur(-1.005)).toBe(-1.0);
  });
  it("handles integer inputs", () => {
    expect(roundEur(42)).toBe(42);
  });
});
