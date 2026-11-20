"use client";
import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { useDashboard } from "@/lib/data";
import { getSupabase } from "@/lib/supabase";
import { DemoNotice } from "@/components/AppShell";
import { Stat, StatusBanner, StatusPill } from "@/components/Status";
import { UptimeBars, UptimeLegend } from "@/components/UptimeBars";
import { IncidentList } from "@/components/IncidentList";
import { formatMs, formatPct, timeAgo } from "@/lib/format";

export default function DashboardPage() {
  const { data, session, reload } = useDashboard();

  if (!data) return <Skeleton />;

  const checks = data.checks;
  const enabled = checks.filter((c) => c.enabled);
  const uptimes = enabled.map((c) => c.uptime_30d).filter((v): v is number => v !== null);
  const p95s = enabled.map((c) => c.p95_24h).filter((v): v is number => v !== null);
  const openIncidents = data.incidents.filter((i) => !i.resolved_at).length;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  return (
    <>
      {data.demo && <DemoNotice />}
      {data.error && <p className="mb-4 rounded-card bg-down-soft px-4 py-3 text-[14px] text-down-ink">Couldn&apos;t load everything: {data.error}. Have the migrations been applied?</p>}

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="serif text-[44px] leading-none">Overview</h1>
          <p className="mt-2 text-[15px] text-muted">{session?.user.email ?? "Demo workspace"} · {checks.length} checks</p>
        </div>
        <Link href="/dashboard/checks/new" className="pill-primary">+ New check</Link>
      </div>

      <StatusBanner
        states={enabled.map((c) => (c.state === "down" ? "down" : "up"))}
        updated={enabled.length ? `Last run ${timeAgo(enabled.map((c) => c.last_run_at).filter(Boolean).sort().at(-1) ?? null)}` : undefined}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label="30-day uptime" value={formatPct(avg(uptimes), 2)} hint={`Across ${uptimes.length} checks`} />
        <Stat label="p95 response" value={formatMs(avg(p95s))} hint="Mean of check p95s, last 24h" />
        <Stat label="Open incidents" value={String(openIncidents)} hint={openIncidents ? "Needs attention" : "Nothing on fire"} tone={openIncidents ? "down" : undefined} />
      </div>

      {!data.demo && data.projects.length === 0 && <NewProject onCreated={reload} userId={session!.user.id} />}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section className="card" aria-labelledby="checks-h">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 id="checks-h" className="text-[15px] font-semibold">Checks · 90-day uptime</h2>
            <UptimeLegend />
          </div>
          <ul className="divide-y divide-line">
            {checks.map((c, i) => (
              <motion.li key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <Link href={`/dashboard/checks/${c.id}`} className="block px-5 py-4 transition-colors hover:bg-bg/60">
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="shrink-0 text-[13px] text-muted">{c.project_name}</span>
                      {c.type === "browser" && <span className="shrink-0 rounded-full bg-bg px-2 py-0.5 text-[11px] text-muted">journey</span>}
                    </div>
                    <div className="flex items-center gap-3 text-[13px] tabular-nums text-muted">
                      <span title="Median response, 24h">p50 {formatMs(c.p50_24h)}</span>
                      <span title="95th percentile response, 24h">p95 {formatMs(c.p95_24h)}</span>
                      <span className="text-ink">{formatPct(c.uptime_90d)}</span>
                      <StatusPill state={c.enabled ? c.state : "paused"} />
                    </div>
                  </div>
                  <UptimeBars daily={c.daily} height={22} compact />
                </Link>
              </motion.li>
            ))}
            {checks.length === 0 && (
              <li className="px-5 py-10 text-center text-muted">
                No checks yet. <Link href="/dashboard/checks/new" className="text-coral-ink underline">Create your first one</Link>.
              </li>
            )}
          </ul>
        </section>

        <section className="card h-fit p-5" aria-labelledby="inc-h">
          <h2 id="inc-h" className="mb-4 text-[15px] font-semibold">Recent incidents</h2>
          <IncidentList incidents={data.incidents} empty="No incidents yet — nice." />
        </section>
      </div>

      {!data.demo && data.projects.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[15px] font-semibold">Public status pages</h2>
          <div className="flex flex-wrap gap-2">
            {data.projects.map((p) => (
              <Link key={p.id} href={`/status/${p.slug}`} className="pill-outline !py-2 text-[14px]">
                /status/{p.slug} {p.is_public ? "" : "(private)"}
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function NewProject({ onCreated, userId }: { onCreated: () => void; userId: string }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await getSupabase()!.from("projects").insert({ name, slug, owner_id: userId });
    if (error) setErr(error.message);
    else onCreated();
  };
  return (
    <form onSubmit={create} className="card mt-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label htmlFor="pname" className="label">Create your first project</label>
        <input id="pname" className="field" placeholder="e.g. Jars" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        {slug && <p className="mt-1 text-[12px] text-muted">Status page: /status/{slug}</p>}
        {err && <p className="mt-1 text-[13px] text-down-ink">{err}</p>}
      </div>
      <button className="pill-primary">Create project</button>
    </form>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="h-10 w-48 rounded-lg bg-line" />
      <div className="h-14 rounded-card bg-line/70" />
      <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-card bg-line/60" />)}</div>
      <div className="h-80 rounded-card bg-line/50" />
    </div>
  );
}
