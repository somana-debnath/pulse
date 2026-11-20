import type { Browser } from "playwright";
import { withRetry, type CheckRow, type RunResult } from "@pulse/core";
import { runHttpCheck } from "./http";
import { runBrowserCheck } from "./browser";

export interface RunOptions {
  browser?: Browser;
  env?: NodeJS.ProcessEnv;
  retryBaseDelayMs?: number;
  journeysDir?: string;
  log?: (msg: string) => void;
}

/**
 * Run a check with in-run retries and exponential backoff. A run only counts as
 * failed if every attempt fails — transient network blips are absorbed here,
 * and sustained failures still need 2 consecutive failed runs to open an incident.
 */
export async function runCheck(check: CheckRow, opts: RunOptions = {}): Promise<RunResult> {
  const once = () => (check.type === "browser" ? runBrowserCheck(check, opts) : runHttpCheck(check));
  const { value, attempts } = await withRetry(once, {
    attempts: check.retries + 1,
    baseDelayMs: opts.retryBaseDelayMs ?? 2000,
    maxDelayMs: 15_000,
    jitter: 0.3,
    isFailure: (r) => !r.ok,
    onRetry: ({ attempt, delayMs, value: v }) => opts.log?.(`  ↻ ${check.name}: attempt ${attempt} failed (${v?.error}); retrying in ${delayMs}ms`),
  });
  return { ...value, attempts };
}

export { runHttpCheck, runBrowserCheck };
