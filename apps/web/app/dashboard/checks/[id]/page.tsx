"use client";
import Link from "next/link";
import { use, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useCheckDetail } from "@/lib/data";
import { DemoNotice } from "@/components/AppShell";
import { CheckEditor } from "@/components/CheckEditor";
import { ResponseChart } from "@/components/ResponseChart";
import { Stat, StatusPill } from "@/components/Status";
import { UptimeBars, UptimeLegend } from "@/components/UptimeBars";
import { IncidentList } from "@/components/IncidentList";
import { formatDate, formatMs, formatPct, timeAgo } from "@/lib/format";
import type { RunView } from "@/lib/types";

export default function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data } = useCheckDetail(id);
  const [tab, setTab] = useState<"runs" | "settings">("runs");

  if (!data) return <div className="h-96 animate-pulse rounded-card bg-line/50" aria-busy="true" />;
  if (!data.check) return <p className="text-muted">Check not found. <Link href="/dashboard" className="text-coral-ink underline">Back to overview</Link></p>;

  const s = data.summary;
  const c = data.check as { name: string; url: string | null; type: string; interval_minutes: number; enabled: boolean; state: "up" | "down" | "unknown"; last_run_at: string | null };

  return (
    <>
      {data.demo && <DemoNotice />}
      <Link href="/dashboard" className="text-[14px] text-muted hover:text-ink">← Overview</Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="serif truncate text-[44px] leading-none">{c.name}</h1>
            <StatusPill state={c.enabled ? c.state : "paused"} />
          </div>
          <p className="mt-2 truncate text-[15px] text-muted">
            {c.type === "browser" ? "User journey" : "URL check"} · every {c.interval_minutes} min · {c.url} · last run {timeAgo(c.last_run_at)}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <Stat label="30-day uptime" value={formatPct(s?.uptime_30d)} />
        <Stat label="90-day uptime" value={formatPct(s?.uptime_90d)} />
        <Stat label="p50 response" value={formatMs(data.latency?.p50)} hint="Last 24h" />
        <Stat label="p95 response" value={formatMs(data.latency?.p95)} hint={`${data.latency?.samples ?? 0} passing runs`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <ResponseChart series={data.series} />
        </section>
        <section className="card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[14px] font-medium">Uptime, last 90 days</h2>
            <UptimeLegend />
          </div>
          <UptimeBars daily={s?.daily ?? null} height={56} />
        </section>
      </div>

      <div className="mt-8 flex gap-1 border-b border-line" role="tablist">
        {(["runs", "settings"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`relative px-4 py-2.5 text-[14px] ${tab === t ? "text-ink" : "text-muted"}`}>
            {t === "runs" ? "Recent runs & incidents" : "Settings"}
            {tab === t && <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-coral" />}
          </button>
        ))}
      </div>

      <div className="pt-6">
        {tab === "runs" ? (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <section className="card" aria-label="Recent runs">
              <RunsTable runs={data.runs} />
            </section>
            <section className="card h-fit p-5">
              <h2 className="mb-4 text-[15px] font-semibold">Incidents</h2>
              <IncidentList incidents={data.incidents} />
            </section>
          </div>
        ) : (
          <CheckEditor initial={data.check} checkId={data.demo ? undefined : id} readOnly={data.demo} />
        )}
      </div>
    </>
  );
}

function RunsTable({ runs }: { runs: RunView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!runs.length) return <p className="px-5 py-10 text-center text-muted">No runs yet. The worker will run this check on its next tick.</p>;
  return (
    <ul className="divide-y divide-line">
      {runs.map((r) => {
        const expanded = open === r.id;
        const max = Math.max(1, ...(r.steps ?? []).map((s) => s.duration_ms));
        return (
          <li key={r.id}>
            <button type="button" onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded} className="flex w-full items-center gap-3 px-5 py-3 text-left text-[14px] transition-colors hover:bg-bg/60">
              <span className={`h-2 w-2 shrink-0 rounded-full ${r.ok ? "bg-up" : "bg-down"}`} aria-hidden="true" />
              <span className="w-14 shrink-0 font-medium">{r.ok ? "Passed" : "Failed"}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{formatDate(r.started_at)}{r.error ? ` · ${r.error}` : ""}</span>
              {r.attempts > 1 && <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] text-warn-ink">{r.attempts} attempts</span>}
              <span className="w-16 shrink-0 text-right tabular-nums">{formatMs(r.duration_ms)}</span>
            </button>
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <ol className="space-y-2 px-5 pb-4 pl-10">
                    {(r.steps ?? []).map((s) => (
                      <li key={s.idx} className="text-[13px]">
                        <div className="flex items-center gap-3">
                          <span className="w-40 shrink-0 truncate sm:w-56">{s.ok ? "✓" : "✗"} {s.name}</span>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
                            <span className={`block h-full rounded-full ${s.ok ? "bg-ink/50" : "bg-down"}`} style={{ width: `${(s.duration_ms / max) * 100}%` }} />
                          </span>
                          <span className="w-14 shrink-0 text-right tabular-nums text-muted">{formatMs(s.duration_ms)}</span>
                        </div>
                        {s.error && <p className="mt-1 font-mono text-[12px] text-down-ink">{s.error}</p>}
                        {s.screenshot_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.screenshot_url} alt={`Screenshot of failed step: ${s.name}`} className="mt-2 w-full max-w-md rounded-[10px] border border-line" />
                        )}
                      </li>
                    ))}
                  </ol>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        );
      })}
    </ul>
  );
}
