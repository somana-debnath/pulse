/**
 * Integration: real Playwright + real HTTP against a local site we can break on demand.
 * Exercises the whole pipeline: runner -> retries -> state machine -> idempotent
 * recording -> incident open/resolve -> deduplicated alerts with screenshots.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { startTestSite, type SiteMode, type TestSite } from "@pulse/test-site";
import type { AlertEvent, JourneyStep, Notifier } from "@pulse/core";
import { runCheck } from "../../src/runners";
import { MemoryStore } from "../../src/store/memory";
import { processCheck, tick } from "../../src/engine";
import type { CheckWithProject } from "../../src/store/types";

let site: TestSite;
let browser: Browser;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

const journey: JourneyStep[] = [
  { name: "Open login", action: "goto", url: "/login" },
  { name: "Enter email", action: "fill", selector: "input[type=email]", value: "bot@pulse.dev" },
  { name: "Enter password", action: "fill", selector: "input[type=password]", value: "{{env.ACME_PASSWORD}}" },
  { name: "Submit", action: "click", selector: "button[type=submit]" },
  { name: "Logged in", action: "expectText", selector: "h1", value: "Welcome" },
  { name: "Search", action: "fill", selector: "input[name=q]", value: "jar" },
  { name: "Run search", action: "click", selector: "[data-testid=search-btn]", timeoutMs: 1500 },
  { name: "See results", action: "expectVisible", selector: "[data-testid=product]" },
  { name: "Add to cart", action: "click", selector: "[data-testid=product] button" },
  { name: "Cart has item", action: "expectText", selector: "[data-testid=cart-count]", value: "1" },
];

function check(over: Partial<CheckWithProject>): CheckWithProject {
  return {
    id: "chk",
    project_id: "p",
    name: "Check",
    type: "http",
    url: site.url,
    method: "GET",
    expected_status: 200,
    max_response_ms: null,
    steps: null,
    script: null,
    interval_minutes: 5,
    timeout_ms: 5000,
    retries: 0,
    enabled: true,
    state: "unknown",
    consecutive_failures: 0,
    consecutive_successes: 0,
    state_version: 0,
    last_slot: null,
    last_run_at: null,
    created_at: new Date().toISOString(),
    project: { id: "p", name: "Acme Shop", slug: "acme" },
    ...over,
  };
}

const env = { ...process.env, ACME_PASSWORD: "correct-horse" };
const run = (c: CheckWithProject) => runCheck(c, { browser, env, retryBaseDelayMs: 50 });

beforeAll(async () => {
  site = await startTestSite();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  await site?.close();
});

describe("HTTP checks against the toggleable site", () => {
  it("passes when the site is up", async () => {
    site.setMode("up");
    const r = await run(check({ url: `${site.url}/health` }));
    expect(r.ok).toBe(true);
    expect(r.statusCode).toBe(200);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("fails with the status code when the site is down, after retrying", async () => {
    site.setMode("down");
    const r = await run(check({ url: `${site.url}/health`, retries: 2 }));
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(503);
    expect(r.attempts).toBe(3);
    expect(r.error).toMatch(/Expected HTTP 200, got 503/);
  });

  it("enforces the request timeout", async () => {
    site.setMode("slow");
    const r = await run(check({ url: `${site.url}/`, timeout_ms: 600 }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out after 600ms/);
  });

  it("enforces the response-time budget", async () => {
    site.setMode("slow");
    const r = await run(check({ url: `${site.url}/`, timeout_ms: 10_000, max_response_ms: 500 }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/budget 500ms/);
  });
});

describe("Playwright journeys", () => {
  it("runs a full login → search → add to cart journey with per-step timings", async () => {
    site.setMode("up");
    const r = await run(check({ type: "browser", steps: journey }));
    expect(r.error ?? null).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.name)).toEqual(journey.map((s) => s.name));
    expect(r.steps.every((s) => s.ok && s.durationMs >= 0)).toBe(true);
  });

  it("runs a code journey from apps/worker/journeys", async () => {
    site.setMode("up");
    const r = await run(check({ type: "browser", script: "acme-checkout" }));
    expect(r.error ?? null).toBeNull();
    expect(r.steps).toHaveLength(5);
  });

  it("pinpoints the failing step and screenshots it when the search button breaks", async () => {
    site.setMode("broken-search");
    const r = await run(check({ type: "browser", steps: journey }));
    expect(r.ok).toBe(false);
    const failed = r.steps.at(-1)!;
    expect(failed.name).toBe("Run search");
    expect(failed.ok).toBe(false);
    expect(r.steps.slice(0, -1).every((s) => s.ok)).toBe(true);
    expect(failed.durationMs).toBeLessThan(4000); // per-step timeout (1500ms) honoured
    expect(Array.from(failed.screenshot!.slice(0, 4))).toEqual(PNG_MAGIC);
    expect(r.error).toMatch(/^Run search:/);
  });

  it("fails on the first step when the site is down", async () => {
    site.setMode("down");
    const r = await run(check({ type: "browser", steps: journey }));
    expect(r.ok).toBe(false);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]!.error).toMatch(/HTTP 503/);
  });
});

describe("end-to-end incident lifecycle", () => {
  it("opens after 2 failures, alerts once with a screenshot, resolves after 2 passes", async () => {
    const store = new MemoryStore([check({ id: "journey", name: "Checkout journey", type: "browser", steps: journey })]);
    const sent: AlertEvent[] = [];
    const notifier: Notifier = { channel: "discord", send: async (e) => void sent.push(e) };
    let minute = 0;
    const now = () => new Date(Date.UTC(2026, 0, 1, 12, minute));
    const deps = { store, notifiers: [notifier], run, now };
    const step = async (mode: SiteMode) => {
      site.setMode(mode);
      const out = await tick(deps);
      minute += 5;
      return out[0]!;
    };

    expect((await step("up")).result.ok).toBe(true);
    const blip = await step("broken-search");
    expect(blip.recorded.transition).toBeNull(); // one failure is not an incident
    expect(sent).toHaveLength(0);

    const second = await step("broken-search");
    expect(second.recorded.transition).toBe("opened");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "opened", failingStep: "Run search", checkName: "Checkout journey" });
    expect(Array.from(sent[0]!.screenshot!.png!.slice(0, 4))).toEqual(PNG_MAGIC);
    expect(store.incidents[0]!.started_at).toBe(blip.result.startedAt); // outage began at the first failure

    // a retried job in the same slot is ignored: no new run, no new alert
    minute -= 5;
    const fresh = (await store.getCheck("journey"))!;
    const replay = await processCheck(fresh, deps);
    minute += 5;
    expect(replay.recorded.duplicate).toBe(true);
    expect(sent).toHaveLength(1);

    await step("down"); // still down — no re-open
    expect(store.incidents).toHaveLength(1);

    const firstPass = await step("up");
    expect(firstPass.recorded.transition).toBeNull(); // one pass is not a recovery
    const recovered = await step("up");
    expect(recovered.recorded.transition).toBe("resolved");

    expect(sent.map((e) => e.kind)).toEqual(["opened", "resolved"]);
    const inc = store.incidents[0]!;
    expect(inc.resolved_at).toBe(firstPass.result.startedAt); // restored at the first passing run
    const outage = Date.parse(firstPass.result.startedAt) - Date.parse(blip.result.startedAt);
    expect(outage).toBeGreaterThan(0);
    expect(sent[1]!.durationMs).toBe(outage);
    expect(store.runs).toHaveLength(6); // the replayed slot was not recorded
  });
});
