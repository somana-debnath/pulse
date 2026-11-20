import { describe, expect, it } from "vitest";
import type { AlertEvent, RunResult } from "@pulse/core";
import { discordPayload } from "../../src/notifiers/discord";
import { emailContent } from "../../src/notifiers/email";
import { interpolate } from "../../src/runners/browser";
import { MemoryStore } from "../../src/store/memory";
import { processCheck } from "../../src/engine";
import { StateConflictError, type CheckWithProject } from "../../src/store/types";

const opened: AlertEvent = {
  kind: "opened",
  incidentId: "i1",
  checkId: "c1",
  checkName: "Checkout",
  projectName: "Jars",
  projectSlug: "jars",
  url: "https://jars.example.com",
  startedAt: "2026-01-01T10:00:00.000Z",
  failingStep: "Add to cart",
  error: "Timeout 10000ms exceeded waiting for <button>",
  statusPageUrl: "http://localhost:3011/status/jars",
};

export function makeCheck(over: Partial<CheckWithProject> = {}): CheckWithProject {
  return {
    id: "c1",
    project_id: "p1",
    name: "Homepage",
    type: "http",
    url: "http://x",
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
    created_at: "2026-01-01T00:00:00Z",
    project: { id: "p1", name: "Jars", slug: "jars" },
    ...over,
  };
}

const result = (ok: boolean, startedAt: string): RunResult => ({
  ok,
  startedAt,
  finishedAt: startedAt,
  durationMs: 120,
  attempts: 1,
  error: ok ? null : "HTTP 503",
  steps: [{ index: 0, name: "GET /", ok, durationMs: 120, error: ok ? null : "HTTP 503" }],
});

describe("notifier payloads", () => {
  it("discord: opened alert has failing step, error and screenshot attachment", () => {
    const p = discordPayload(opened, true);
    const embed = p.embeds[0]!;
    expect(embed.title).toContain("is down");
    expect(embed.color).toBe(0xe24b4a);
    expect(embed.fields.map((f) => f.name)).toEqual(["Check", "Project", "Started", "Failing step", "Error"]);
    expect(embed.image).toEqual({ url: "attachment://failure.png" });
    expect(p.allowed_mentions.parse).toEqual([]);
  });

  it("discord: resolved alert reports downtime and has no image", () => {
    const p = discordPayload({ ...opened, kind: "resolved", durationMs: 25 * 60_000, resolvedAt: "2026-01-01T10:25:00Z" }, false);
    expect(p.embeds[0]!.title).toContain("recovered");
    expect(p.embeds[0]!.fields.find((f) => f.name === "Downtime")!.value).toBe("25m");
    expect(p.embeds[0]!.image).toBeUndefined();
  });

  it("email: escapes HTML and embeds the screenshot inline", () => {
    const e = emailContent({ ...opened, error: "<script>alert(1)</script>" }, true);
    expect(e.subject).toBe("[Pulse] DOWN: Checkout (Jars)");
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).toContain("cid:failure-screenshot");
  });
});

describe("journey secrets", () => {
  it("interpolates {{env.X}} and fails loudly when missing", () => {
    expect(interpolate("{{env.PW}}", { PW: "s3cret" })).toBe("s3cret");
    expect(() => interpolate("{{ env.NOPE }}", {})).toThrow(/NOPE/);
    expect(interpolate("plain", {})).toBe("plain");
  });
});

describe("engine + store: idempotent recording", () => {
  const slot = (m: number) => new Date(Date.UTC(2026, 0, 1, 10, m * 5));

  it("retrying the same slot never double counts", async () => {
    const store = new MemoryStore([makeCheck({ state: "up" })]);
    let check = (await store.getCheck("c1"))!;
    const run = async () => result(false, slot(0).toISOString());
    const first = await processCheck(check, { store, notifiers: [], run, now: () => slot(0) });
    check = (await store.getCheck("c1"))!; // a retried job re-reads fresh state
    const retry = await processCheck(check, { store, notifiers: [], run, now: () => new Date(slot(0).getTime() + 60_000) });
    expect(first.recorded.duplicate).toBe(false);
    expect(retry.recorded.duplicate).toBe(true);
    expect(store.runs).toHaveLength(1);
    expect((await store.getCheck("c1"))!.consecutive_failures).toBe(1);
  });

  it("a stale state_version is rejected and the engine re-reads", async () => {
    const store = new MemoryStore([makeCheck({ state: "up" })]);
    const stale = (await store.getCheck("c1"))!;
    // another worker records a failure in the meantime
    await processCheck(stale, { store, notifiers: [], run: async () => result(false, slot(0).toISOString()), now: () => slot(0) });
    await expect(
      store.recordRun({
        checkId: "c1",
        idempotencyKey: "x",
        slot: slot(1),
        run: { started_at: slot(1).toISOString(), finished_at: slot(1).toISOString(), ok: false, duration_ms: 1, status_code: null, error: null, attempts: 1, region: "t" },
        steps: [],
        expectedVersion: 0,
        next: { state: "down", consecutiveFailures: 1, consecutiveSuccesses: 0 },
        transition: null,
        failingStep: null,
        error: null,
        screenshotUrl: null,
      }),
    ).rejects.toBeInstanceOf(StateConflictError);
    // the engine handles it transparently: the second failure (from stale state) still opens the incident
    const out = await processCheck(stale, { store, notifiers: [], run: async () => result(false, slot(1).toISOString()), now: () => slot(1) });
    expect(out.recorded.transition).toBe("opened");
    expect(store.incidents).toHaveLength(1);
    expect(store.incidents[0]!.started_at).toBe(slot(0).toISOString());
  });
});
