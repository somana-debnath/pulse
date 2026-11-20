"use client";
import { useState } from "react";
import { uptimeLevel } from "@pulse/core";
import type { DailyPoint } from "@/lib/types";
import { formatDate, formatDuration, formatPct } from "@/lib/format";

const FILL: Record<ReturnType<typeof uptimeLevel>, string> = {
  none: "bg-none",
  up: "bg-up",
  degraded: "bg-warn",
  down: "bg-down",
};
const LABEL: Record<ReturnType<typeof uptimeLevel>, string> = {
  none: "No data",
  up: "Operational",
  degraded: "Degraded",
  down: "Outage",
};

/**
 * 90 daily bars. Each bar is a focusable button with a tooltip (hover or keyboard),
 * and the colour is never the only signal: the tooltip states the level in words.
 */
export function UptimeBars({ daily, days = 90, height = 32, compact = false }: { daily: DailyPoint[] | null; days?: number; height?: number; compact?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const points = (daily ?? []).slice(-days);
  const padded: DailyPoint[] = [...Array.from({ length: Math.max(0, days - points.length) }, () => ({ day: "", uptime: null })), ...points];

  return (
    <div className="relative" onMouseLeave={() => setActive(null)}>
      <div className="flex items-end gap-[2px]" style={{ height }} role="list" aria-label={`Daily uptime, last ${days} days`}>
        {padded.map((p, i) => {
          const level = uptimeLevel(p.uptime);
          return (
            <button
              key={i}
              type="button"
              role="listitem"
              aria-label={p.day ? `${formatDate(p.day + "T00:00:00Z", false)}: ${LABEL[level]}${p.uptime !== null ? `, ${formatPct(p.uptime, 2)} uptime` : ""}` : "No data"}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className={`h-full min-w-0 flex-1 rounded-[3px] transition-[transform,opacity] duration-150 hover:scale-y-[1.08] focus-visible:scale-y-[1.08] ${FILL[level]} ${
                active !== null && active !== i ? "opacity-60" : ""
              } ${compact ? "rounded-[2px]" : ""}`}
            />
          );
        })}
      </div>
      {active !== null && padded[active]?.day && (
        <Tooltip point={padded[active]!} index={active} total={padded.length} />
      )}
      {!compact && (
        <div className="mt-2 flex justify-between text-[12px] text-muted">
          <span>{days} days ago</span>
          <span>Today</span>
        </div>
      )}
    </div>
  );
}

function Tooltip({ point, index, total }: { point: DailyPoint; index: number; total: number }) {
  const level = uptimeLevel(point.uptime);
  const left = `${((index + 0.5) / total) * 100}%`;
  const align = index < total * 0.2 ? "translate-x-0" : index > total * 0.8 ? "-translate-x-full" : "-translate-x-1/2";
  return (
    <div role="tooltip" className={`pointer-events-none absolute bottom-full z-20 mb-2 w-max max-w-[220px] ${align} rounded-[10px] border border-line bg-card px-3 py-2 text-[13px] shadow-soft`} style={{ left }}>
      <div className="font-medium text-ink">{formatDate(point.day + "T00:00:00Z", false)}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-muted">
        <span className={`inline-block h-2 w-2 rounded-full ${FILL[level]}`} aria-hidden="true" />
        {LABEL[level]}
        {point.uptime !== null && <span className="tabular-nums text-ink">· {formatPct(point.uptime, 2)}</span>}
      </div>
      {!!point.downtime_seconds && point.downtime_seconds > 0 && (
        <div className="mt-0.5 text-muted">Down for {formatDuration(point.downtime_seconds * 1000)}</div>
      )}
    </div>
  );
}

export function UptimeLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted" aria-label="Legend">
      {(["up", "degraded", "down", "none"] as const).map((l) => (
        <li key={l} className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-[3px] ${FILL[l]}`} aria-hidden="true" />
          {LABEL[l]}
        </li>
      ))}
    </ul>
  );
}
