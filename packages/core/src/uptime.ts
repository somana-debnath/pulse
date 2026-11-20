/**
 * Uptime & latency maths.
 *
 * Production numbers are computed in SQL (see supabase/migrations/0003_analytics.sql).
 * These TypeScript twins implement the *same* definitions so they can be unit
 * tested exhaustively and used for demo data; the SQL test-suite asserts both agree.
 *
 * Definition: uptime is time-based, not run-based.
 *   uptime(window) = 1 - downtime(window) / monitored(window)
 * where downtime is the union of incident intervals clipped to the window
 * (an open incident extends to `now`), and monitored time starts at the check's
 * first run, so a check created mid-day is not penalised for the hours before it existed.
 */

export const DAY_MS = 86_400_000;

export interface Interval {
  start: number; // epoch ms
  end: number | null; // null = still open
}

/** Merge overlapping/adjacent intervals after clipping them to [from, to). */
export function mergeIntervals(intervals: Interval[], from: number, to: number, now: number): [number, number][] {
  const clipped = intervals
    .map(({ start, end }) => [Math.max(start, from), Math.min(end ?? now, to)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const iv of clipped) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

export function downtimeMs(intervals: Interval[], from: number, to: number, now: number): number {
  return mergeIntervals(intervals, from, to, now).reduce((sum, [s, e]) => sum + (e - s), 0);
}

/**
 * Uptime percentage (0..100) for a window. Returns null when nothing was monitored
 * in the window (e.g. before the check existed) so the UI can show "no data".
 */
export function uptimePercent(
  incidents: Interval[],
  from: number,
  to: number,
  opts: { now: number; monitoredSince: number | null },
): number | null {
  if (opts.monitoredSince === null) return null;
  const start = Math.max(from, opts.monitoredSince);
  const end = Math.min(to, opts.now);
  const monitored = end - start;
  if (monitored <= 0) return null;
  const down = downtimeMs(incidents, start, end, opts.now);
  return round3(100 * (1 - down / monitored));
}

export interface DayBucket {
  day: string; // YYYY-MM-DD (UTC)
  uptime: number | null;
  downtimeMs: number;
}

/** One bucket per UTC day for the last `days` days, oldest first (today is last). */
export function dailyUptime(
  incidents: Interval[],
  days: number,
  opts: { now: number; monitoredSince: number | null },
): DayBucket[] {
  const todayStart = Math.floor(opts.now / DAY_MS) * DAY_MS;
  const buckets: DayBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const from = todayStart - i * DAY_MS;
    const to = from + DAY_MS;
    const uptime = uptimePercent(incidents, from, to, opts);
    const down =
      uptime === null
        ? 0
        : downtimeMs(incidents, Math.max(from, opts.monitoredSince ?? from), Math.min(to, opts.now), opts.now);
    buckets.push({ day: new Date(from).toISOString().slice(0, 10), uptime, downtimeMs: down });
  }
  return buckets;
}

/**
 * Continuous percentile with linear interpolation — identical semantics to
 * Postgres `percentile_cont(p) within group (order by x)`.
 */
export function percentile(values: number[], p: number): number | null {
  if (p < 0 || p > 1 || Number.isNaN(p)) throw new RangeError("p must be within [0, 1]");
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const rank = p * (xs.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = xs[lo]!;
  const b = xs[hi]!;
  return a + (b - a) * (rank - lo);
}

/** Bar colour bucket for an uptime value. Thresholds match the status page legend. */
export function uptimeLevel(uptime: number | null): "none" | "up" | "degraded" | "down" {
  if (uptime === null) return "none";
  if (uptime >= 99.9) return "up";
  if (uptime >= 95) return "degraded";
  return "down";
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
