export type DisplayState = "up" | "down" | "unknown" | "paused" | "degraded";

export interface DailyPoint {
  day: string;
  uptime: number | null;
  downtime_seconds?: number;
}

export interface SeriesPoint {
  t: string;
  p50: number | null;
  p95: number | null;
}

/** Shape returned by the SQL function status_page(slug). */
export interface StatusPageData {
  project: { name: string; slug: string; description: string | null; website_url: string | null };
  generated_at: string;
  checks: {
    id: string;
    name: string;
    type: "http" | "browser";
    state: DisplayState;
    uptime_90d: number | null;
    daily: DailyPoint[] | null;
    latency: { p50: number | null; p95: number | null; avg_ms: number | null; samples: number } | null;
    series: SeriesPoint[];
  }[];
  incidents: {
    id: string;
    check_name: string;
    started_at: string;
    resolved_at: string | null;
    duration_seconds: number;
    failing_step: string | null;
  }[];
}

/** Shape returned by the SQL function dashboard_checks(). */
export interface DashboardCheck {
  id: string;
  project_id: string;
  project_name: string;
  project_slug: string;
  name: string;
  type: "http" | "browser";
  url: string | null;
  state: "unknown" | "up" | "down";
  enabled: boolean;
  interval_minutes: number;
  last_run_at: string | null;
  uptime_30d: number | null;
  uptime_90d: number | null;
  p50_24h: number | null;
  p95_24h: number | null;
  daily: DailyPoint[] | null;
}

export interface IncidentView {
  id: string;
  check_id: string;
  check_name: string;
  project_name?: string;
  started_at: string;
  resolved_at: string | null;
  failing_step: string | null;
  error: string | null;
  screenshot_url: string | null;
}

export interface RunView {
  id: string;
  check_id: string;
  check_name?: string;
  started_at: string;
  ok: boolean;
  duration_ms: number;
  status_code: number | null;
  error: string | null;
  attempts: number;
  steps?: { idx: number; name: string; ok: boolean; duration_ms: number; error: string | null; screenshot_url: string | null }[];
}

export interface ProjectView {
  id: string;
  name: string;
  slug: string;
  is_public: boolean;
}
