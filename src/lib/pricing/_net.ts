// Network discipline for external pricing calls (audit R1): every call gets a
// hard timeout so a hung provider can never stall a cron run or an import,
// and cron paths retry transient failures with backoff.

export class ExternalCallTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "ExternalCallTimeoutError";
  }
}

export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Race a promise against a timeout. yahoo-finance2 doesn't take an
 * AbortSignal, so the underlying request may continue in the background —
 * but the caller is unblocked and the run fails fast.
 */
export async function withTimeout<T>(
  run: Promise<T>,
  ms: number = DEFAULT_TIMEOUT_MS,
  label = "external call",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ExternalCallTimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry with exponential backoff. For cron paths only — interactive paths
 * (imports) fail fast and report instead.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 250;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
      }
    }
  }
  throw lastErr;
}
