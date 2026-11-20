"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { IncidentView } from "@/lib/types";
import { formatDate, formatDuration, timeAgo } from "@/lib/format";
import { StatusPill } from "./Status";

export function IncidentList({ incidents, showScreenshots = true, empty = "No incidents in the last 90 days." }: { incidents: IncidentView[]; showScreenshots?: boolean; empty?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!incidents.length) return <p className="py-6 text-center text-[14px] text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {incidents.map((i) => {
        const dur = (i.resolved_at ? Date.parse(i.resolved_at) : Date.now()) - Date.parse(i.started_at);
        const expanded = open === i.id;
        return (
          <li key={i.id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              {showScreenshots && i.screenshot_url && (
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : i.id)}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Hide" : "Show"} screenshot of failing step for ${i.check_name}`}
                  className="group relative h-[72px] w-full shrink-0 overflow-hidden rounded-[10px] border border-line bg-bg sm:w-[120px]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.screenshot_url} alt="" className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-105" />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{i.project_name ? `${i.project_name} · ` : ""}{i.check_name}</span>
                  <StatusPill state={i.resolved_at ? "up" : "down"} label={i.resolved_at ? "Resolved" : "Ongoing"} />
                </div>
                <p className="mt-1 text-[14px] text-muted">
                  {i.resolved_at ? "Resolved" : "Ongoing"} · {formatDuration(dur)} · started {timeAgo(i.started_at)}
                  <span className="hidden sm:inline"> ({formatDate(i.started_at)})</span>
                </p>
                {i.failing_step && (
                  <p className="mt-1.5 text-[14px] text-ink">
                    Failed at <span className="rounded-md bg-bg px-1.5 py-0.5 font-mono text-[13px]">{i.failing_step}</span>
                  </p>
                )}
                {i.error && <p className="mt-1 break-words font-mono text-[12px] text-muted">{i.error}</p>}
              </div>
            </div>
            <AnimatePresence initial={false}>
              {expanded && i.screenshot_url && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.screenshot_url} alt={`Screenshot when "${i.failing_step}" failed`} className="mt-3 w-full rounded-[10px] border border-line" />
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        );
      })}
    </ul>
  );
}
