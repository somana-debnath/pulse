import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  dailyUptime,
  downtimeMs,
  formatDuration,
  mergeIntervals,
  percentile,
  uptimeLevel,
  uptimePercent,
} from "../src/uptime";

const T0 = Date.UTC(2026, 0, 10); // midnight UTC
const H = 3_600_000;

describe("interval merging", () => {
  it("merges overlapping and adjacent intervals", () => {
    const merged = mergeIntervals(
      [
        { start: T0 + 2 * H, end: T0 + 4 * H },
        { start: T0 + 1 * H, end: T0 + 3 * H },
        { start: T0 + 4 * H, end: T0 + 5 * H },
        { start: T0 + 8 * H, end: T0 + 9 * H },
      ],
      T0,
      T0 + DAY_MS,
      T0 + DAY_MS,
    );
    expect(merged).toEqual([
      [T0 + 1 * H, T0 + 5 * H],
      [T0 + 8 * H, T0 + 9 * H],
    ]);
  });

  it("clips to the window and extends open incidents to now", () => {
    const now = T0 + 6 * H;
    expect(downtimeMs([{ start: T0 - 5 * H, end: T0 + 1 * H }], T0, T0 + DAY_MS, now)).toBe(H);
    expect(downtimeMs([{ start: T0 + 5 * H, end: null }], T0, T0 + DAY_MS, now)).toBe(H);
  });

  it("does not double count overlapping incidents", () => {
    const iv = [
      { start: T0, end: T0 + 2 * H },
      { start: T0 + H, end: T0 + 2 * H },
    ];
    expect(downtimeMs(iv, T0, T0 + DAY_MS, T0 + DAY_MS)).toBe(2 * H);
  });
});

describe("uptime percent", () => {
  const opts = { now: T0 + DAY_MS, monitoredSince: T0 - 30 * DAY_MS };

  it("is 100 with no incidents", () => {
    expect(uptimePercent([], T0, T0 + DAY_MS, opts)).toBe(100);
  });

  it("is 95.833 with a one-hour outage in a day", () => {
    expect(uptimePercent([{ start: T0, end: T0 + H }], T0, T0 + DAY_MS, opts)).toBe(95.833);
  });

  it("is 0 for a full-day outage", () => {
    expect(uptimePercent([{ start: T0 - H, end: T0 + DAY_MS + H }], T0, T0 + DAY_MS, opts)).toBe(0);
  });

  it("returns null before monitoring started", () => {
    expect(uptimePercent([], T0, T0 + DAY_MS, { now: T0 + DAY_MS, monitoredSince: null })).toBeNull();
    expect(uptimePercent([], T0, T0 + DAY_MS, { now: T0 + DAY_MS, monitoredSince: T0 + 2 * DAY_MS })).toBeNull();
  });

  it("only counts monitored time when a check starts mid-window", () => {
    // monitored for 12h, down for 6h of them -> 50%
    const r = uptimePercent([{ start: T0 + 12 * H, end: T0 + 18 * H }], T0, T0 + DAY_MS, {
      now: T0 + DAY_MS,
      monitoredSince: T0 + 12 * H,
    });
    expect(r).toBe(50);
  });

  it("does not count the future part of the current day", () => {
    const r = uptimePercent([{ start: T0, end: T0 + H }], T0, T0 + DAY_MS, { now: T0 + 4 * H, monitoredSince: T0 - DAY_MS });
    expect(r).toBe(75);
  });

  it("30-day uptime with a 43-minute outage is ~99.9%", () => {
    const now = T0 + 30 * DAY_MS;
    const r = uptimePercent([{ start: T0 + 5 * DAY_MS, end: T0 + 5 * DAY_MS + 43 * 60_000 }], T0, now, {
      now,
      monitoredSince: T0,
    });
    expect(r).toBeCloseTo(99.9, 1);
  });
});

describe("daily uptime buckets", () => {
  it("returns one bucket per day, oldest first, today last", () => {
    const now = T0 + 10 * H;
    const buckets = dailyUptime([{ start: T0 - DAY_MS + 6 * H, end: T0 - DAY_MS + 12 * H }], 90, {
      now,
      monitoredSince: T0 - 3 * DAY_MS,
    });
    expect(buckets).toHaveLength(90);
    expect(buckets.at(-1)!.day).toBe("2026-01-10");
    expect(buckets.at(-1)!.uptime).toBe(100);
    expect(buckets.at(-2)!.uptime).toBe(75);
    expect(buckets.at(-2)!.downtimeMs).toBe(6 * H);
    expect(buckets.at(-5)!.uptime).toBeNull(); // before monitoring
  });

  it("splits an incident that crosses midnight across two days", () => {
    const now = T0 + DAY_MS + 12 * H;
    const b = dailyUptime([{ start: T0 - 2 * H, end: T0 + 4 * H }], 3, { now, monitoredSince: T0 - 5 * DAY_MS });
    expect(b.map((x) => x.downtimeMs)).toEqual([2 * H, 4 * H, 0]);
  });
});

describe("percentile (percentile_cont semantics)", () => {
  it("handles empty and single inputs", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([42], 0.95)).toBe(42);
  });

  it("interpolates linearly like Postgres", () => {
    const xs = [10, 20, 30, 40];
    expect(percentile(xs, 0.5)).toBe(25);
    expect(percentile(xs, 0.95)).toBeCloseTo(38.5, 10);
    expect(percentile(xs, 0)).toBe(10);
    expect(percentile(xs, 1)).toBe(40);
  });

  it("is order independent and ignores non-finite values", () => {
    expect(percentile([40, NaN, 10, 30, 20, Infinity], 0.5)).toBe(25);
  });

  it("p95 of 1..100 is 95.05", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 0.95)).toBeCloseTo(95.05, 10);
    expect(percentile(xs, 0.5)).toBe(50.5);
  });

  it("rejects invalid p", () => {
    expect(() => percentile([1], 1.5)).toThrow(RangeError);
  });
});

describe("helpers", () => {
  it("maps uptime to bar levels", () => {
    expect(uptimeLevel(null)).toBe("none");
    expect(uptimeLevel(100)).toBe("up");
    expect(uptimeLevel(99.9)).toBe("up");
    expect(uptimeLevel(99.5)).toBe("degraded");
    expect(uptimeLevel(80)).toBe("down");
  });

  it("formats durations", () => {
    expect(formatDuration(350)).toBe("350ms");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(5 * 60_000)).toBe("5m");
    expect(formatDuration(3 * H + 20 * 60_000)).toBe("3h 20m");
    expect(formatDuration(DAY_MS + 2 * H)).toBe("1d 2h");
  });
});
