"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { DashboardCheck } from "@/lib/types";
import { UptimeBars } from "../UptimeBars";
import { StatusDot } from "../Status";
import { formatMs, formatPct } from "@/lib/format";

const ease = [0.22, 1, 0.36, 1] as const;

export function HeroIntro() {
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}>
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3.5 py-1.5 text-[13px] text-muted shadow-soft">
          <span className="relative inline-flex h-2 w-2" aria-hidden="true">
            <span className="ping-dot relative h-2 w-2 rounded-full bg-up" />
          </span>
          Open source · free to run
        </span>
      </motion.div>
      <motion.h1
        className="serif mx-auto mt-7 max-w-4xl text-[56px] leading-[0.98] sm:text-[84px] lg:text-[96px]"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.05, ease }}
      >
        Know it&apos;s broken
        <br />
        <em className="text-coral">before your users do.</em>
      </motion.h1>
      <motion.p
        className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-muted sm:text-[19px]"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15, ease }}
      >
        Pulse acts like a real user on your site every few minutes, logging in, searching and checking out, and pings you the moment something breaks.
      </motion.p>
      <motion.div
        className="mt-9 flex flex-wrap justify-center gap-3"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.25, ease }}
      >
        <Link href="/dashboard" className="pill-primary px-6 py-3 text-[16px]">
          Start monitoring
        </Link>
        <Link href="/status/demo" className="pill-outline px-6 py-3 text-[16px]">
          See a live status page
        </Link>
      </motion.div>
    </>
  );
}

/** A live-looking status card: a run "ticks" every few seconds to show Pulse at work. */
export function LiveStatusCard({ checks }: { checks: DashboardCheck[] }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setTick((t) => t + 1), 2600);
    return () => clearInterval(id);
  }, []);
  const activeIdx = tick % checks.length;

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <StatusDot state="up" pulse />
          <span className="text-[15px] font-semibold">All systems operational</span>
        </div>
        <span className="text-[12px] text-muted">Last 90 days</span>
      </div>
      <ul className="mt-5 space-y-5">
        {checks.map((c, i) => (
          <li key={c.id}>
            <div className="mb-2 flex items-center justify-between gap-3 text-[14px]">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{c.project_name} · {c.name}</span>
                {c.type === "browser" && <span className="shrink-0 rounded-full bg-bg px-2 py-0.5 text-[11px] text-muted">journey</span>}
              </span>
              <span className="flex shrink-0 items-center gap-3 tabular-nums text-muted">
                <motion.span
                  key={`${c.id}-${i === activeIdx ? tick : "idle"}`}
                  initial={i === activeIdx ? { opacity: 0, y: -4 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  className="hidden text-[12px] sm:inline"
                >
                  {i === activeIdx ? `✓ ran just now · ${formatMs(c.p50_24h)}` : formatMs(c.p50_24h)}
                </motion.span>
                <span className="text-ink">{formatPct(c.uptime_90d, 2)}</span>
              </span>
            </div>
            <UptimeBars daily={c.daily} height={26} compact />
          </li>
        ))}
      </ul>
    </div>
  );
}
