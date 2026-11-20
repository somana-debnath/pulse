/**
 * Runs the real migrations against Postgres and verifies:
 *  - RLS: anon sees nothing, owners see only their own data, nobody can forge runs
 *  - record_run: idempotency, optimistic locking, incident start/end attribution
 *  - claim_alert: exactly-once claims, retry after failure
 *  - SQL uptime & percentiles agree with the TypeScript twins in @pulse/core
 *
 * Uses PULSE_TEST_DATABASE_URL if set (CI), otherwise starts a throwaway
 * postgres:17 container. Skips if neither is available.
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DAY_MS, dailyUptime, percentile, uptimePercent, type Interval } from "../../packages/core/src/uptime";

const ROOT = resolve(import.meta.dirname, "../..");
let url = process.env.PULSE_TEST_DATABASE_URL;
let container: string | null = null;

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canRun = Boolean(url) || dockerAvailable();
let db: pg.Client;

async function connectWithRetry(cs: string): Promise<pg.Client> {
  let last: unknown;
  for (let i = 0; i < 60; i++) {
    const c = new pg.Client({ connectionString: cs });
    try {
      await c.connect();
      await c.query("select 1");
      return c;
    } catch (err) {
      last = err;
      await c.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw last;
}

beforeAll(async () => {
  if (!canRun) return;
  if (!url) {
    const port = 54000 + Math.floor(Math.random() * 900);
    container = execSync(`docker run -d --rm -e POSTGRES_PASSWORD=pulse -p ${port}:5432 postgres:17-alpine`).toString().trim();
    url = `postgres://postgres:pulse@127.0.0.1:${port}/postgres`;
  }
  db = await connectWithRetry(url);
  await db.query(readFileSync(join(ROOT, "supabase/tests/supabase-stub.sql"), "utf8"));
  const migrations = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql") && !f.includes("storage")).sort();
  for (const f of migrations) await db.query(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
  // migrations must be re-runnable
  for (const f of migrations) await db.query(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
});

afterAll(async () => {
  await db?.end().catch(() => {});
  if (container) execSync(`docker rm -f ${container}`, { stdio: "ignore" });
});

/** Run `fn` as an API role inside a rolled-back transaction. */
async function as<T>(role: "anon" | "authenticated" | "service_role", sub: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub ?? ""]);
    await db.query(`set local role ${role}`);
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

async function makeUserProject(isPublic = true) {
  const owner = randomUUID();
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [owner, `${owner}@test.dev`]);
  const slug = `p-${owner.slice(0, 8)}`;
  const { rows: [p] } = await db.query(`insert into projects (owner_id, name, slug, is_public) values ($1, 'Proj', $2, $3) returning id`, [owner, slug, isPublic]);
  const { rows: [c] } = await db.query(
    `insert into checks (project_id, name, type, url, steps) values ($1, 'Journey', 'browser', 'https://x.dev', '[{"action":"fill","selector":"#pw","value":"hunter2"}]') returning id`,
    [p.id],
  );
  return { owner, slug, projectId: p.id as string, checkId: c.id as string };
}

interface RecordArgs {
  key?: string;
  ok: boolean;
  at: Date;
  version: number;
  state: "unknown" | "up" | "down";
  failures: number;
  successes: number;
  transition?: "opened" | "resolved" | null;
  duration?: number;
}

async function recordRun(checkId: string, a: RecordArgs) {
  const { rows } = await db.query(
    `select record_run($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, null) as r`,
    [
      checkId,
      a.key ?? `${checkId}:${a.at.toISOString()}`,
      a.at.toISOString(),
      JSON.stringify({ started_at: a.at.toISOString(), finished_at: a.at.toISOString(), ok: a.ok, duration_ms: a.duration ?? 100, attempts: 1 }),
      JSON.stringify([{ idx: 0, name: "Step", ok: a.ok, duration_ms: a.duration ?? 100 }]),
      a.version,
      a.state,
      a.failures,
      a.successes,
      a.transition ?? null,
      a.ok ? null : "Search",
      a.ok ? null : "boom",
    ],
  );
  return rows[0].r as { duplicate: boolean; run_id: string; transition: string | null; incident_id: string | null };
}

describe.skipIf(!canRun)("SQL migrations", () => {
  describe("row level security", () => {
    it("is enabled on every table", async () => {
      const { rows } = await db.query(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`);
      expect(rows.length).toBe(6);
      expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    });

    it("anon cannot read any table", async () => {
      await makeUserProject();
      for (const t of ["projects", "checks", "runs", "incidents", "alerts", "run_steps"]) {
        await expect(as("anon", null, () => db.query(`select * from ${t}`))).rejects.toThrow(/permission denied/);
      }
    });

    it("owners see only their own projects and checks", async () => {
      const a = await makeUserProject();
      const b = await makeUserProject();
      const seen = await as("authenticated", a.owner, async () => (await db.query(`select id from checks`)).rows.map((r) => r.id));
      expect(seen).toContain(a.checkId);
      expect(seen).not.toContain(b.checkId);
    });

    it("owners cannot create projects for someone else", async () => {
      const a = await makeUserProject();
      await expect(
        as("authenticated", a.owner, () => db.query(`insert into projects (owner_id, name, slug) values ($1, 'x', 'evil-proj')`, [randomUUID()])),
      ).rejects.toThrow(/row-level security/);
    });

    it("owners cannot forge runs, incidents or edit state columns", async () => {
      const a = await makeUserProject();
      await expect(
        as("authenticated", a.owner, () =>
          db.query(`insert into runs (check_id, idempotency_key, slot, started_at, finished_at, ok, duration_ms) values ($1,'k',now(),now(),now(),true,1)`, [a.checkId]),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(as("authenticated", a.owner, () => db.query(`update checks set state = 'up' where id = $1`, [a.checkId]))).rejects.toThrow(/permission denied/);
      const renamed = await as("authenticated", a.owner, async () => (await db.query(`update checks set name = 'Renamed' where id = $1`, [a.checkId])).rowCount);
      expect(renamed).toBe(1);
    });

    it("record_run cannot be called by API roles", async () => {
      const a = await makeUserProject();
      await expect(as("authenticated", a.owner, () => db.query(`select record_run($1,'k',now(),'{}','[]',0,'up',0,1,null)`, [a.checkId]))).rejects.toThrow(
        /permission denied/,
      );
    });

    it("status_page is public but leaks no journey secrets, and hides private projects", async () => {
      const pub = await makeUserProject(true);
      const priv = await makeUserProject(false);
      const page = await as("anon", null, async () => (await db.query(`select status_page($1) as s`, [pub.slug])).rows[0].s);
      expect(page.project.slug).toBe(pub.slug);
      expect(page.checks).toHaveLength(1);
      expect(page.checks[0].daily).toHaveLength(90);
      expect(JSON.stringify(page)).not.toContain("hunter2");
      expect(JSON.stringify(page)).not.toContain("https://x.dev");
      const hidden = await as("anon", null, async () => (await db.query(`select status_page($1) as s`, [priv.slug])).rows[0].s);
      expect(hidden).toBeNull();
    });
  });

  describe("record_run", () => {
    const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 12, 0) + m * 60_000);

    it("is idempotent: a duplicate key records nothing", async () => {
      const { checkId } = await makeUserProject();
      const first = await recordRun(checkId, { key: "same", ok: false, at: t(0), version: 0, state: "unknown", failures: 1, successes: 0 });
      const again = await recordRun(checkId, { key: "same", ok: false, at: t(0), version: 1, state: "down", failures: 2, successes: 0, transition: "opened" });
      expect(first.duplicate).toBe(false);
      expect(again).toMatchObject({ duplicate: true, run_id: first.run_id, transition: null });
      const { rows: [c] } = await db.query(`select state, consecutive_failures, state_version from checks where id = $1`, [checkId]);
      expect(c).toEqual({ state: "unknown", consecutive_failures: 1, state_version: 1 });
      const { rows: [{ n }] } = await db.query(`select count(*)::int n from incidents where check_id = $1`, [checkId]);
      expect(n).toBe(0);
    });

    it("rejects stale state versions and rolls back the run", async () => {
      const { checkId } = await makeUserProject();
      await recordRun(checkId, { ok: true, at: t(0), version: 0, state: "up", failures: 0, successes: 1 });
      await expect(recordRun(checkId, { ok: true, at: t(5), version: 0, state: "up", failures: 0, successes: 2 })).rejects.toThrow(/state_conflict/);
      const { rows: [{ n }] } = await db.query(`select count(*)::int n from runs where check_id = $1`, [checkId]);
      expect(n).toBe(1);
    });

    it("opens at the first failure and resolves at the first pass of the recovery", async () => {
      const { checkId } = await makeUserProject();
      await recordRun(checkId, { ok: true, at: t(0), version: 0, state: "up", failures: 0, successes: 1 });
      await recordRun(checkId, { ok: false, at: t(5), version: 1, state: "up", failures: 1, successes: 0 });
      const opened = await recordRun(checkId, { ok: false, at: t(10), version: 2, state: "down", failures: 2, successes: 0, transition: "opened" });
      expect(opened.transition).toBe("opened");
      await recordRun(checkId, { ok: true, at: t(15), version: 3, state: "down", failures: 0, successes: 1 });
      const resolved = await recordRun(checkId, { ok: true, at: t(20), version: 4, state: "up", failures: 0, successes: 2, transition: "resolved" });
      expect(resolved).toMatchObject({ transition: "resolved", incident_id: opened.incident_id });
      const { rows: [i] } = await db.query(`select started_at, resolved_at, duration_seconds::int d, failing_step from incidents where id = $1`, [opened.incident_id]);
      expect(i.started_at.toISOString()).toBe(t(5).toISOString());
      expect(i.resolved_at.toISOString()).toBe(t(15).toISOString());
      expect(i.d).toBe(600);
      expect(i.failing_step).toBe("Search");
    });

    it("never allows two open incidents for one check", async () => {
      const { checkId } = await makeUserProject();
      await recordRun(checkId, { ok: false, at: t(0), version: 0, state: "down", failures: 2, successes: 0, transition: "opened" });
      const second = await recordRun(checkId, { ok: false, at: t(5), version: 1, state: "down", failures: 3, successes: 0, transition: "opened" });
      expect(second.transition).toBeNull();
      const { rows: [{ n }] } = await db.query(`select count(*)::int n from incidents where check_id = $1`, [checkId]);
      expect(n).toBe(1);
    });
  });

  describe("claim_alert", () => {
    it("claims once, allows retry after failure, then dedupes after success", async () => {
      const { checkId } = await makeUserProject();
      const { incident_id } = await recordRun(checkId, { ok: false, at: new Date(), version: 0, state: "down", failures: 2, successes: 0, transition: "opened" });
      const claim = async () => (await db.query(`select claim_alert($1, $2, 'opened', 'discord') as ok`, [`${incident_id}:opened:discord`, incident_id])).rows[0].ok;
      expect(await claim()).toBe(true);
      expect(await claim()).toBe(false);
      await db.query(`select finish_alert($1, false, 'HTTP 502')`, [`${incident_id}:opened:discord`]);
      expect(await claim()).toBe(true);
      await db.query(`select finish_alert($1, true)`, [`${incident_id}:opened:discord`]);
      expect(await claim()).toBe(false);
      const { rows: [a] } = await db.query(`select status, attempts from alerts where dedup_key = $1`, [`${incident_id}:opened:discord`]);
      expect(a).toEqual({ status: "sent", attempts: 2 });
    });
  });

  describe("SQL maths matches @pulse/core", () => {
    it("daily and window uptime agree with the TypeScript implementation", async () => {
      const { checkId } = await makeUserProject();
      const now = Date.UTC(2026, 2, 15, 13, 30);
      const first = now - 20 * DAY_MS - 5 * 3600_000;
      await db.query(
        `insert into runs (check_id, idempotency_key, slot, started_at, finished_at, ok, duration_ms) values ($1, 'first', $2, $2, $2, true, 100)`,
        [checkId, new Date(first)],
      );
      const incidents: Interval[] = [
        { start: now - 10 * DAY_MS - 2 * 3600_000, end: now - 10 * DAY_MS + 3 * 3600_000 }, // crosses midnight
        { start: now - 10 * DAY_MS, end: now - 10 * DAY_MS + 3600_000 }, // overlaps the first
        { start: now - 3 * DAY_MS, end: now - 3 * DAY_MS + 17 * 60_000 },
        { start: now - 40 * 60_000, end: null }, // open now
      ];
      for (const iv of incidents) {
        await db.query(`insert into incidents (check_id, started_at, resolved_at) values ($1, $2, $3) on conflict do nothing`, [
          checkId,
          new Date(iv.start),
          iv.end ? new Date(iv.end) : null,
        ]);
      }
      const { rows } = await db.query(`select day::text, uptime::float8 as uptime, downtime_seconds::float8 as dt from check_daily_uptime($1, 90, $2)`, [
        checkId,
        new Date(now),
      ]);
      const ts = dailyUptime(incidents, 90, { now, monitoredSince: first });
      expect(rows.map((r) => r.day)).toEqual(ts.map((b) => b.day));
      rows.forEach((r, i) => {
        expect(r.uptime).toBe(ts[i]!.uptime);
        expect(r.dt).toBeCloseTo(ts[i]!.downtimeMs / 1000, 3);
      });
      expect(rows.filter((r) => r.uptime !== null && r.uptime < 100).length).toBeGreaterThanOrEqual(3);

      const { rows: [w] } = await db.query(`select check_window_uptime($1, $2, $3, $3)::float8 as u`, [checkId, new Date(now - 30 * DAY_MS), new Date(now)]);
      expect(w.u).toBe(uptimePercent(incidents, now - 30 * DAY_MS, now, { now, monitoredSince: first }));
    });

    it("p50 / p95 from percentile_cont match percentile()", async () => {
      const { checkId } = await makeUserProject();
      const durations = Array.from({ length: 57 }, (_, i) => Math.round(80 + ((i * 7919) % 400) + (i % 9 === 0 ? 1500 : 0)));
      const base = Date.now() - 3600_000;
      for (const [i, d] of durations.entries()) {
        const at = new Date(base + i * 60_000);
        await db.query(`insert into runs (check_id, idempotency_key, slot, started_at, finished_at, ok, duration_ms) values ($1, $2, $3, $3, $3, true, $4)`, [
          checkId,
          `k${i}`,
          at,
          d,
        ]);
      }
      await db.query(`insert into runs (check_id, idempotency_key, slot, started_at, finished_at, ok, duration_ms) values ($1, 'failed', now(), now(), now(), false, 99999)`, [checkId]);
      const { rows: [l] } = await db.query(`select p50::float8, p95::float8, samples::int from check_latency($1)`, [checkId]);
      expect(l.samples).toBe(57); // failed runs are excluded
      expect(l.p50).toBeCloseTo(percentile(durations, 0.5)!, 1);
      expect(l.p95).toBeCloseTo(percentile(durations, 0.95)!, 1);
    });
  });
});
