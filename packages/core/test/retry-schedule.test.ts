import { describe, expect, it, vi } from "vitest";
import { TimeoutError, backoffDelay, withRetry, withTimeout } from "../src/retry";
import { isDue, mapLimit, runIdempotencyKey, slotStart } from "../src/schedule";
import { resolveUrl, validateJourney } from "../src/journey";

describe("backoff", () => {
  it("grows exponentially and caps at max", () => {
    const o = { baseDelayMs: 100, factor: 2, maxDelayMs: 1000, jitter: 0 };
    expect([1, 2, 3, 4, 5, 6].map((a) => backoffDelay(a, o))).toEqual([100, 200, 400, 800, 1000, 1000]);
  });

  it("full jitter stays within [0, raw]", () => {
    const o = { baseDelayMs: 1000, jitter: 1 };
    expect(backoffDelay(1, { ...o, random: () => 0 })).toBe(0);
    expect(backoffDelay(1, { ...o, random: () => 0.999999 })).toBe(1000);
  });
});

describe("withRetry", () => {
  const sleep = vi.fn(async () => {});

  it("retries thrown errors then succeeds", async () => {
    let n = 0;
    const r = await withRetry(async () => {
      if (++n < 3) throw new Error("flaky");
      return "ok";
    }, { attempts: 3, sleep });
    expect(r).toEqual({ value: "ok", attempts: 3 });
  });

  it("gives up after the configured attempts", async () => {
    await expect(withRetry(async () => { throw new Error("down"); }, { attempts: 2, sleep })).rejects.toThrow("down");
  });

  it("retries failed values and returns the last one", async () => {
    const fn = vi.fn(async () => ({ ok: false }));
    const r = await withRetry(fn, { attempts: 3, sleep, isFailure: (v) => !v.ok });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(r.attempts).toBe(3);
    expect(r.value.ok).toBe(false);
  });

  it("stops retrying when shouldRetry says no", async () => {
    const fn = vi.fn(async () => { throw new Error("fatal"); });
    await expect(withRetry(fn, { attempts: 5, sleep, shouldRetry: () => false })).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("withTimeout", () => {
  it("rejects with TimeoutError and aborts the signal", async () => {
    let aborted = false;
    const p = withTimeout(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => (aborted = true));
          setTimeout(resolve, 1000);
        }),
      20,
      "step",
    );
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
    expect(aborted).toBe(true);
  });

  it("resolves when fast enough", async () => {
    await expect(withTimeout(async () => 7, 100)).resolves.toBe(7);
  });
});

describe("scheduling and idempotency", () => {
  const at = Date.UTC(2026, 0, 1, 12, 7, 31);

  it("floors time to the interval slot", () => {
    expect(slotStart(at, 5).toISOString()).toBe("2026-01-01T12:05:00.000Z");
    expect(slotStart(at, 15).toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("produces the same key for any retry inside the slot", () => {
    const a = runIdempotencyKey("c1", slotStart(at, 5));
    const b = runIdempotencyKey("c1", slotStart(at + 2 * 60_000, 5));
    const c = runIdempotencyKey("c1", slotStart(at + 3 * 60_000, 5));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("isDue is false within the already-recorded slot and true in the next", () => {
    const slot = slotStart(at, 5);
    expect(isDue(null, 5, at)).toBe(true);
    expect(isDue(slot, 5, at)).toBe(false);
    expect(isDue(slot.toISOString(), 5, at + 5 * 60_000)).toBe(true);
  });

  it("mapLimit respects concurrency and order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (x) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return x * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });
});

describe("journey validation", () => {
  it("accepts a valid journey and names unnamed steps", () => {
    const r = validateJourney([
      { action: "goto", url: "/" },
      { action: "fill", selector: "#q", value: "jars" },
      { action: "click", selector: "button[type=submit]", name: "Search" },
      { action: "expectText", selector: "main", value: "results" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.value!.map((s) => s.name)).toEqual(["Open /", "Fill #q", "Search", 'See "results"']);
  });

  it("reports every problem", () => {
    const r = validateJourney([{ action: "teleport" }, { action: "click" }, { action: "goto" }, { action: "wait", value: "1", timeoutMs: 5 }]);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(4);
  });

  it("rejects non-arrays and empty journeys", () => {
    expect(validateJourney({}).ok).toBe(false);
    expect(validateJourney([]).ok).toBe(false);
  });

  it("resolves relative URLs against the check URL", () => {
    expect(resolveUrl("https://shop.example.com/app", "/login")).toBe("https://shop.example.com/login");
    expect(resolveUrl("https://a.com", "https://b.com/x")).toBe("https://b.com/x");
  });
});
