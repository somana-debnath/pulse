"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { StatusPageData } from "@/lib/types";
import { StatusBanner, StatusPill } from "./Status";
import { UptimeBars, UptimeLegend } from "./UptimeBars";
import { ResponseChart } from "./ResponseChart";
import { Reveal } from "./Reveal";
import { formatDate, formatDuration, formatMs, formatPct, timeAgo } from "@/lib/format";

export function StatusPageView({ data, demo }: { data: StatusPageData; demo: boolean }) {
  const [openChart, setOpenChart] = useState<string | null>(data.checks[0]?.id ?? null);
  const byMonth = groupByMonth(data.incidents);

  return (
    <>
      <Reveal>
        <h1 className="serif text-[44px] leading-tight sm:text-[56px]">{data.project.name}</h1>
        {data.project.description && <p className="mt-1 text-[16px] text-muted">{data.project.description}</p>}
        {demo && (
          <p className="mt-3 inline-flex rounded-full border border-line bg-card px-3 py-1 text-[12px] text-muted">Demo data — connect Supabase and run the worker to see real checks</p>
        )}
      </Reveal>

      <Reveal delay={0.05} className="mt-8">
        <StatusBanner states={data.checks.map((c) => c.state)} updated={`Updated ${timeAgo(data.generated_at)}`} />
      </Reveal>

      <Reveal delay={0.1} className="mt-6">
        <section className="card divide-y divide-line" aria-labelledby="checks-h">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <h2 id="checks-h" className="text-[15px] font-semibold">Uptime · last 90 days</h2>
            <UptimeLegend />
          </div>
          {data.checks.map((c) => {
            const expanded = openChart === c.id;
            return (
              <div key={c.id} className="px-5 py-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    <StatusPill state={c.state} />
                  </div>
                  <div className="flex items-center gap-3 text-[14px]">
                    <span className="tabular-nums text-ink">{formatPct(c.uptime_90d, 2)} uptime</span>
                    <button
                      type="button"
                      onClick={() => setOpenChart(expanded ? null : c.id)}
                      aria-expanded={expanded}
                      className="rounded-full border border-line px-3 py-1 text-[12px] text-muted transition-colors hover:text-ink"
                    >
                      {expanded ? "Hide" : "Response time"}
                    </button>
                  </div>
                </div>
                <UptimeBars daily={c.daily} />
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
                      <div className="pt-6">
                        <div className="mb-4 flex gap-6 text-[13px] text-muted">
                          <span>p50 <b className="font-semibold tabular-nums text-ink">{formatMs(c.latency?.p50)}</b></span>
                          <span>p95 <b className="font-semibold tabular-nums text-ink">{formatMs(c.latency?.p95)}</b></span>
                        </div>
                        <ResponseChart series={c.series} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
          {data.checks.length === 0 && <p className="px-5 py-8 text-center text-muted">No checks configured yet.</p>}
        </section>
      </Reveal>

      <Reveal delay={0.1} className="mt-10">
        <section aria-labelledby="hist-h">
          <h2 id="hist-h" className="serif text-[32px]">Incident history</h2>
          {byMonth.length === 0 && <p className="card mt-4 px-5 py-8 text-center text-muted">No incidents in the last 90 days. 🎉</p>}
          <div className="mt-4 space-y-6">
            {byMonth.map(([month, items]) => (
              <div key={month}>
                <h3 className="mb-2 text-[13px] font-medium uppercase tracking-wide text-muted">{month}</h3>
                <ul className="card divide-y divide-line">
                  {items.map((i) => (
                    <li key={i.id} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{i.check_name}</span>
                          <StatusPill state={i.resolved_at ? "up" : "down"} label={i.resolved_at ? "Resolved" : "Ongoing"} />
                        </div>
                        <p className="mt-1 text-[14px] text-muted">
                          {i.failing_step ? <>Failed at <span className="text-ink">{i.failing_step}</span> · </> : null}
                          {formatDate(i.started_at)}
                        </p>
                      </div>
                      <span className="text-[14px] tabular-nums text-muted">
                        {i.resolved_at ? `Down for ${formatDuration(i.duration_seconds * 1000)}` : `Ongoing · ${formatDuration(i.duration_seconds * 1000)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </Reveal>
    </>
  );
}

function groupByMonth(incidents: StatusPageData["incidents"]) {
  const map = new Map<string, StatusPageData["incidents"]>();
  for (const i of incidents) {
    const k = new Date(i.started_at).toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
    map.set(k, [...(map.get(k) ?? []), i]);
  }
  return [...map.entries()];
}
