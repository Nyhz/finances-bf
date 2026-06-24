import { describe, expect, it } from "vitest";
import { momentum, pctBelow52wHigh, pctChange, rollingMax, sma } from "../ta";

describe("discover/ta", () => {
  it("sma averages the last n closes, null when too short", () => {
    expect(sma([2, 4, 6], 3)).toBe(4);
    expect(sma([1, 2, 4, 6], 3)).toBe(4); // last 3
    expect(sma([1, 2], 3)).toBeNull();
  });

  it("rollingMax takes the max of the last n", () => {
    expect(rollingMax([1, 9, 3, 4], 3)).toBe(9); // last 3 = [9,3,4]
    expect(rollingMax([1, 9, 3, 4], 2)).toBe(4); // last 2 = [3,4]
    expect(rollingMax([], 5)).toBeNull();
  });

  it("pctChange is (to-from)/from", () => {
    expect(pctChange(100, 110)).toBeCloseTo(0.1, 6);
    expect(pctChange(100, 80)).toBeCloseTo(-0.2, 6);
    expect(pctChange(0, 5)).toBe(0);
  });

  it("momentum is the return over the last n sessions", () => {
    expect(momentum([10, 11, 12], 2)).toBeCloseTo(0.2, 6);
    expect(momentum([10, 12], 2)).toBeNull(); // needs n+1 points
  });

  it("pctBelow52wHigh is non-positive vs the rolling high", () => {
    expect(pctBelow52wHigh([10, 20, 15])).toBeCloseTo(-0.25, 6);
    expect(pctBelow52wHigh([10, 20, 20])).toBeCloseTo(0, 6);
    expect(pctBelow52wHigh([])).toBeNull();
  });
});
