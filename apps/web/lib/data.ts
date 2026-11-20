"use client";
import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { demoCheckById, demoDashboardChecks, demoIncidents, demoRuns, demoSeries } from "./demo";
import type { DashboardCheck, IncidentView, ProjectView, RunView, SeriesPoint } from "./types";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return setReady(true);
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return { session, ready };
}

interface RawIncident {
  id: string;
  check_id: string;
  started_at: string;
  resolved_at: string | null;
  failing_step: string | null;
  error: string | null;
  screenshot_url: string | null;
  checks: { name: string; projects: { name: string } | null } | null;
}

const toIncident = (r: RawIncident): IncidentView => ({
  id: r.id,
  check_id: r.check_id,
  check_name: r.checks?.name ?? "Check",
  project_name: r.checks?.projects?.name,
  started_at: r.started_at,
  resolved_at: r.resolved_at,
  failing_step: r.failing_step,
  error: r.error,
  screenshot_url: r.screenshot_url,
});

export interface DashboardData {
  demo: boolean;
  projects: ProjectView[];
  checks: DashboardCheck[];
  incidents: IncidentView[];
  error?: string;
}

export function useDashboard() {
  const { session, ready } = useSession();
  const [data, setData] = useState<DashboardData | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !session) {
      setData({ demo: true, projects: [], checks: demoDashboardChecks(), incidents: demoIncidents().slice(0, 4) });
      return;
    }
    const [p, c, i] = await Promise.all([
      sb.from("projects").select("id, name, slug, is_public").order("name"),
      sb.rpc("dashboard_checks"),
      sb
        .from("incidents")
        .select("id, check_id, started_at, resolved_at, failing_step, error, screenshot_url, checks(name, projects(name))")
        .order("started_at", { ascending: false })
        .limit(4),
    ]);
    const error = p.error?.message ?? c.error?.message ?? i.error?.message;
    setData({
      demo: false,
      projects: (p.data ?? []) as ProjectView[],
      checks: (c.data ?? []) as DashboardCheck[],
      incidents: ((i.data ?? []) as unknown as RawIncident[]).map(toIncident),
      error,
    });
  }, [session]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  return { data, session, ready, reload: load };
}

export interface CheckDetail {
  demo: boolean;
  check: Record<string, unknown> | null;
  summary: DashboardCheck | null;
  latency: { p50: number | null; p95: number | null; avg_ms: number | null; samples: number } | null;
  series: SeriesPoint[];
  runs: RunView[];
  incidents: IncidentView[];
}

export function useCheckDetail(id: string) {
  const { session, ready } = useSession();
  const [data, setData] = useState<CheckDetail | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const demo = demoCheckById(id);
    if (!sb || !session || demo) {
      if (!demo) return setData({ demo: true, check: null, summary: null, latency: null, series: [], runs: [], incidents: [] });
      setData({
        demo: true,
        check: { ...demo, method: "GET", expected_status: 200, max_response_ms: 2000, timeout_ms: 15000, retries: 1, steps: null, script: null },
        summary: demo,
        latency: { p50: demo.p50_24h, p95: demo.p95_24h, avg_ms: demo.p50_24h, samples: 288 },
        series: demoSeries(id),
        runs: demoRuns(id),
        incidents: demoIncidents().filter((i) => i.check_id === id),
      });
      return;
    }
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [c, dash, l, s, r, i] = await Promise.all([
      sb.from("checks").select("*").eq("id", id).maybeSingle(),
      sb.rpc("dashboard_checks"),
      sb.rpc("check_latency", { p_check_id: id, p_since: since }),
      sb.rpc("check_response_series", { p_check_id: id, p_since: since }),
      sb
        .from("runs")
        .select("id, check_id, started_at, ok, duration_ms, status_code, error, attempts, steps:run_steps(idx, name, ok, duration_ms, error, screenshot_url)")
        .eq("check_id", id)
        .order("started_at", { ascending: false })
        .limit(25),
      sb
        .from("incidents")
        .select("id, check_id, started_at, resolved_at, failing_step, error, screenshot_url, checks(name, projects(name))")
        .eq("check_id", id)
        .order("started_at", { ascending: false })
        .limit(10),
    ]);
    setData({
      demo: false,
      check: c.data,
      summary: ((dash.data ?? []) as DashboardCheck[]).find((d) => d.id === id) ?? null,
      latency: (l.data as CheckDetail["latency"][] | null)?.[0] ?? null,
      series: ((s.data ?? []) as { bucket: string; p50: number; p95: number }[]).map((x) => ({ t: x.bucket, p50: x.p50, p95: x.p95 })),
      runs: ((r.data ?? []) as RunView[]).map((run) => ({ ...run, steps: [...(run.steps ?? [])].sort((a, b) => a.idx - b.idx) })),
      incidents: ((i.data ?? []) as unknown as RawIncident[]).map(toIncident),
    });
  }, [id, session]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  return { data, session, reload: load };
}
