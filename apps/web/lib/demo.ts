/**
 * Deterministic demo data so the landing page, dashboard and /status/demo look
 * alive before any checks have run. Uptime is computed with the same @pulse/core
 * functions whose definitions match the SQL.
 */
import { DAY_MS, dailyUptime, percentile, uptimePercent, type Interval } from "@pulse/core";
import type { DashboardCheck, IncidentView, RunView, StatusPageData } from "./types";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoCheckDef {
  id: string;
  project: "scam-shield" | "jars" | "portfolio";
  name: string;
  type: "http" | "browser";
  url: string;
  base: number; // median latency ms
  incidents: { daysAgo: number; hour: number; minutes: number; step?: string; error?: string; open?: boolean }[];
}

const PROJECTS = {
  "scam-shield": { id: "p-scam", name: "Scam Shield", description: "Real-time scam detection for messages and links." },
  jars: { id: "p-jars", name: "Jars", description: "Savings jars and shared budgets." },
  portfolio: { id: "p-port", name: "Portfolio", description: "Personal portfolio and blog." },
} as const;

const DEFS: DemoCheckDef[] = [
  { id: "d1", project: "scam-shield", name: "Homepage", type: "http", url: "https://scam-shield.example.com", base: 180, incidents: [{ daysAgo: 41, hour: 3, minutes: 12 }] },
  { id: "d2", project: "scam-shield", name: "API health", type: "http", url: "https://scam-shield.example.com/api/health", base: 95, incidents: [] },
  {
    id: "d3",
    project: "scam-shield",
    name: "Scan a suspicious link",
    type: "browser",
    url: "https://scam-shield.example.com",
    base: 2400,
    incidents: [
      { daysAgo: 12, hour: 14, minutes: 38, step: "See a verdict", error: "Timeout 20000ms exceeded waiting for [data-testid=verdict]" },
      { daysAgo: 63, hour: 9, minutes: 95, step: "Run the scan", error: "locator.click: element is not enabled" },
    ],
  },
  { id: "d4", project: "jars", name: "Web app", type: "http", url: "https://jars.example.com", base: 210, incidents: [{ daysAgo: 27, hour: 22, minutes: 9 }] },
  {
    id: "d5",
    project: "jars",
    name: "Log in and open a jar",
    type: "browser",
    url: "https://jars.example.com",
    base: 3100,
    incidents: [
      { daysAgo: 4, hour: 11, minutes: 22, step: "Submit", error: "Expected HTTP 200, got 502 on POST /api/session" },
      { daysAgo: 52, hour: 18, minutes: 240, step: "Dashboard loads", error: "Timeout 15000ms exceeded waiting for [data-testid=jars-list]" },
    ],
  },
  { id: "d6", project: "portfolio", name: "Homepage", type: "http", url: "https://portfolio.example.com", base: 140, incidents: [] },
  { id: "d7", project: "portfolio", name: "Projects page renders", type: "browser", url: "https://portfolio.example.com", base: 1700, incidents: [{ daysAgo: 70, hour: 6, minutes: 31, step: "See a project" }] },
];

export function demoNow(): number {
  return Math.floor(Date.now() / 60_000) * 60_000;
}

function intervalsFor(def: DemoCheckDef, now: number): Interval[] {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  return def.incidents.map((i) => {
    const start = today - i.daysAgo * DAY_MS + i.hour * 3600_000;
    return { start, end: i.open ? null : start + i.minutes * 60_000 };
  });
}

function latencySeries(def: DemoCheckDef, now: number, hours = 24) {
  const r = rng(def.id.charCodeAt(1) * 977);
  const out: { t: string; p50: number; p95: number }[] = [];
  const startHour = Math.floor(now / 3600_000) * 3600_000 - (hours - 1) * 3600_000;
  for (let h = 0; h < hours; h++) {
    const t = startHour + h * 3600_000;
    const hourOfDay = new Date(t).getUTCHours();
    const load = 1 + 0.25 * Math.sin(((hourOfDay - 9) / 24) * Math.PI * 2);
    const samples = Array.from({ length: 12 }, () => def.base * load * (0.8 + r() * 0.5) + (r() > 0.93 ? def.base * 1.4 : 0));
    out.push({ t: new Date(t).toISOString(), p50: Math.round(percentile(samples, 0.5)!), p95: Math.round(percentile(samples, 0.95)!) });
  }
  return out;
}

function checkMetrics(def: DemoCheckDef, now: number) {
  const incidents = intervalsFor(def, now);
  const monitoredSince = now - 89.5 * DAY_MS;
  const series = latencySeries(def, now);
  const all = series.flatMap((s) => [s.p50, s.p50, s.p50, s.p95]);
  return {
    incidents,
    daily: dailyUptime(incidents, 90, { now, monitoredSince }).map((b) => ({ day: b.day, uptime: b.uptime, downtime_seconds: b.downtimeMs / 1000 })),
    uptime30: uptimePercent(incidents, now - 30 * DAY_MS, now, { now, monitoredSince }),
    uptime90: uptimePercent(incidents, now - 90 * DAY_MS, now, { now, monitoredSince }),
    p50: Math.round(percentile(all, 0.5)!),
    p95: Math.round(percentile(all, 0.95)!),
    series,
  };
}

export const DEMO_SLUGS = ["demo", "scam-shield", "jars", "portfolio"];

export function demoStatusPage(slug: string, now = demoNow()): StatusPageData | null {
  if (!DEMO_SLUGS.includes(slug)) return null;
  const defs = slug === "demo" ? DEFS : DEFS.filter((d) => d.project === slug);
  const project =
    slug === "demo"
      ? { name: "Pulse demo", slug: "demo", description: "Example checks for Scam Shield, Jars and a portfolio site.", website_url: null }
      : { name: PROJECTS[slug as keyof typeof PROJECTS].name, slug, description: PROJECTS[slug as keyof typeof PROJECTS].description, website_url: null };

  return {
    project,
    generated_at: new Date(now).toISOString(),
    checks: defs.map((d) => {
      const m = checkMetrics(d, now);
      return {
        id: d.id,
        name: slug === "demo" ? `${PROJECTS[d.project].name} · ${d.name}` : d.name,
        type: d.type,
        state: "up",
        uptime_90d: m.uptime90,
        daily: m.daily,
        latency: { p50: m.p50, p95: m.p95, avg_ms: m.p50, samples: 288 },
        series: m.series,
      };
    }),
    incidents: demoIncidents(now)
      .filter((i) => slug === "demo" || DEFS.find((d) => d.id === i.check_id)!.project === slug)
      .map((i) => ({
        id: i.id,
        check_name: slug === "demo" ? `${i.project_name} · ${i.check_name}` : i.check_name,
        started_at: i.started_at,
        resolved_at: i.resolved_at,
        duration_seconds: i.resolved_at ? (Date.parse(i.resolved_at) - Date.parse(i.started_at)) / 1000 : (now - Date.parse(i.started_at)) / 1000,
        failing_step: i.failing_step,
      })),
  };
}

export function demoDashboardChecks(now = demoNow()): DashboardCheck[] {
  return DEFS.map((d) => {
    const m = checkMetrics(d, now);
    const p = PROJECTS[d.project];
    return {
      id: d.id,
      project_id: p.id,
      project_name: p.name,
      project_slug: d.project,
      name: d.name,
      type: d.type,
      url: d.url,
      state: "up",
      enabled: true,
      interval_minutes: d.type === "browser" ? 10 : 5,
      last_run_at: new Date(now - ((d.id.charCodeAt(1) * 37) % 240) * 1000).toISOString(),
      uptime_30d: m.uptime30,
      uptime_90d: m.uptime90,
      p50_24h: m.p50,
      p95_24h: m.p95,
      daily: m.daily,
    };
  });
}

export function demoIncidents(now = demoNow()): IncidentView[] {
  return DEFS.flatMap((d) =>
    intervalsFor(d, now).map((iv, k) => {
      const meta = d.incidents[k]!;
      return {
        id: `${d.id}-i${k}`,
        check_id: d.id,
        check_name: d.name,
        project_name: PROJECTS[d.project].name,
        started_at: new Date(iv.start).toISOString(),
        resolved_at: iv.end ? new Date(iv.end).toISOString() : null,
        failing_step: meta.step ?? (d.type === "http" ? `GET ${d.url}` : null),
        error: meta.error ?? (d.type === "http" ? "Expected HTTP 200, got 503" : "Step failed"),
        screenshot_url: d.type === "browser" ? "/demo/failure.png" : null,
      };
    }),
  ).sort((a, b) => b.started_at.localeCompare(a.started_at));
}

export function demoRuns(checkId: string, now = demoNow(), count = 20): RunView[] {
  const def = DEFS.find((d) => d.id === checkId) ?? DEFS[0]!;
  const r = rng(def.id.charCodeAt(1) * 131);
  const every = (def.type === "browser" ? 10 : 5) * 60_000;
  const journeySteps: Record<string, string[]> = {
    d3: ["Open home page", "Paste a link", "Run the scan", "See a verdict"],
    d5: ["Open login", "Enter email", "Enter password", "Submit", "Dashboard loads"],
    d7: ["Open home", "Go to projects", "See a project"],
  };
  return Array.from({ length: count }, (_, i) => {
    const ok = !(i === 6 && def.type === "browser");
    const total = Math.round(def.base * (0.8 + r() * 0.5));
    const names = journeySteps[def.id] ?? [`GET ${def.url}`];
    const failAt = ok ? -1 : names.length - 1;
    const weights = names.map(() => 0.5 + r());
    const sum = weights.reduce((a, b) => a + b, 0);
    return {
      id: `${def.id}-r${i}`,
      check_id: def.id,
      check_name: def.name,
      started_at: new Date(Math.floor(now / every) * every - i * every).toISOString(),
      ok,
      duration_ms: total,
      status_code: def.type === "http" ? 200 : null,
      error: ok ? null : "Run the scan: Timeout 15000ms exceeded",
      attempts: ok ? 1 : 2,
      steps: names.slice(0, failAt === -1 ? names.length : failAt + 1).map((name, idx) => ({
        idx,
        name,
        ok: idx !== failAt,
        duration_ms: Math.round((weights[idx]! / sum) * total),
        error: idx === failAt ? "Timeout 15000ms exceeded" : null,
        screenshot_url: idx === failAt ? "/demo/failure.png" : null,
      })),
    };
  });
}

export function demoCheckById(id: string) {
  return demoDashboardChecks().find((c) => c.id === id) ?? null;
}

export function demoSeries(id: string, now = demoNow()) {
  const def = DEFS.find((d) => d.id === id) ?? DEFS[0]!;
  return latencySeries(def, now);
}
