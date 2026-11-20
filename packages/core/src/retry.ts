/** Retry with exponential backoff + full jitter, and hard timeouts. */

export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  /** 0 = no jitter, 1 = full jitter (delay uniformly in [0, computed]). */
  jitter?: number;
  random?: () => number;
}

export function backoffDelay(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 10_000;
  const factor = opts.factor ?? 2;
  const jitter = Math.min(1, Math.max(0, opts.jitter ?? 0.5));
  const random = opts.random ?? Math.random;
  const raw = Math.min(max, base * Math.pow(factor, Math.max(0, attempt - 1)));
  return Math.round(raw * (1 - jitter) + raw * jitter * random());
}

export interface RetryOptions<T> extends BackoffOptions {
  /** Total attempts including the first. */
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Treat a resolved value as failure (e.g. a failed check result) to trigger a retry. */
  isFailure?: (value: T) => boolean;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error?: unknown; value?: T }) => void;
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions<T> = {}): Promise<RetryResult<T>> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const value = await fn(attempt);
      if (opts.isFailure?.(value) && attempt < attempts) {
        const delayMs = backoffDelay(attempt, opts);
        opts.onRetry?.({ attempt, delayMs, value });
        await sleep(delayMs);
        continue;
      }
      return { value, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || (opts.shouldRetry && !opts.shouldRetry(err))) throw err;
      const delayMs = backoffDelay(attempt, opts);
      opts.onRetry?.({ attempt, delayMs, error: err });
      await sleep(delayMs);
    }
  }
  throw lastError;
}

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/** Run `fn` with an AbortSignal that fires after `ms`; rejects with TimeoutError. */
export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, label = "operation"): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(label, ms));
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
