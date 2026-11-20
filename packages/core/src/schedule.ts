/**
 * Scheduling & idempotency.
 *
 * Time is divided into fixed slots of `intervalMinutes`. A run's idempotency key
 * is `checkId:slotStart`, so however many times a job is retried or re-run
 * (GitHub Actions re-runs, a worker restart, two overlapping crons) the database
 * accepts at most one run per check per slot — `runs.idempotency_key` is UNIQUE
 * and `record_run` turns a duplicate into a no-op that touches no counters.
 */

export function slotStart(now: Date | number, intervalMinutes: number): Date {
  const ms = typeof now === "number" ? now : now.getTime();
  const size = Math.max(1, intervalMinutes) * 60_000;
  return new Date(Math.floor(ms / size) * size);
}

export function runIdempotencyKey(checkId: string, slot: Date): string {
  return `${checkId}:${slot.toISOString()}`;
}

/**
 * A check is due when no run has been recorded for the current slot.
 * GitHub cron can fire minutes late, so we key on slots, not "now - last >= interval".
 */
export function isDue(lastSlot: Date | string | null, intervalMinutes: number, now: Date | number): boolean {
  if (!lastSlot) return true;
  const last = typeof lastSlot === "string" ? new Date(lastSlot) : lastSlot;
  return slotStart(now, intervalMinutes).getTime() > last.getTime();
}

/** Run `items` through `fn` with at most `limit` in flight. Preserves order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}
