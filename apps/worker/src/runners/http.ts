import { TimeoutError, withTimeout, type CheckRow, type RunResult } from "@pulse/core";

export const USER_AGENT = "PulseBot/0.1 (+https://github.com/somana-debnath/pulse; synthetic monitoring)";

/** Single-attempt HTTP check: status code + response-time budget. */
export async function runHttpCheck(check: Pick<CheckRow, "url" | "method" | "expected_status" | "max_response_ms" | "timeout_ms">): Promise<RunResult> {
  const startedAt = new Date();
  const t0 = performance.now();
  let statusCode: number | null = null;
  let error: string | null = null;

  try {
    if (!check.url) throw new Error("HTTP check has no URL");
    const res = await withTimeout(
      (signal) => fetch(check.url!, { method: check.method || "GET", redirect: "follow", signal, headers: { "user-agent": USER_AGENT } }),
      check.timeout_ms,
      `${check.method} ${check.url}`,
    );
    statusCode = res.status;
    await res.arrayBuffer().catch(() => undefined); // include body download in timing
    const durationMs = Math.round(performance.now() - t0);
    if (res.status !== check.expected_status) error = `Expected HTTP ${check.expected_status}, got ${res.status}`;
    else if (check.max_response_ms && durationMs > check.max_response_ms)
      error = `Response took ${durationMs}ms (budget ${check.max_response_ms}ms)`;
  } catch (err) {
    error = err instanceof TimeoutError ? err.message : `Request failed: ${(err as Error).cause ? String((err as Error & { cause: unknown }).cause) : (err as Error).message}`;
  }

  const durationMs = Math.round(performance.now() - t0);
  const ok = error === null;
  return {
    ok,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs,
    statusCode,
    error,
    attempts: 1,
    steps: [{ index: 0, name: `${check.method || "GET"} ${check.url}`, ok, durationMs, error }],
  };
}
