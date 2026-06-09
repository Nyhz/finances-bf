import { describe, expect, it, vi } from "vitest";
import { ExternalCallTimeoutError, withRetry, withTimeout } from "./_net";

describe("withTimeout", () => {
  it("rejects a hung promise within the timeout", async () => {
    const hung = new Promise<never>(() => {});
    await expect(withTimeout(hung, 20, "test call")).rejects.toThrow(
      ExternalCallTimeoutError,
    );
  });

  it("passes through a resolving promise", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it("passes through a rejecting promise unchanged", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("provider down")), 1000),
    ).rejects.toThrow("provider down");
  });
});

describe("withRetry", () => {
  it("retries transient failures and returns the eventual success", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("flaky 1"))
      .mockRejectedValueOnce(new Error("flaky 2"))
      .mockResolvedValueOnce("ok");
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error after exhausting attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("hard down"));
    await expect(withRetry(fn, { attempts: 2, baseDelayMs: 1 })).rejects.toThrow(
      "hard down",
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
