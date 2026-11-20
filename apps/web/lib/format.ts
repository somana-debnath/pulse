import { formatDuration } from "@pulse/core";

export { formatDuration };

export function formatPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—";
  if (v === 100) return "100%";
  return `${v.toFixed(digits)}%`;
}

export function formatMs(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v >= 1000 ? `${parseFloat((v / 1000).toFixed(v >= 10_000 ? 1 : 2))}s` : `${Math.round(v)}ms`;
}

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function formatDate(iso: string, withTime = true): string {
  return new Date(iso).toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "UTC",
  }) + (withTime ? " UTC" : "");
}
