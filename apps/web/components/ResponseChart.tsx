"use client";
import { useMemo, useRef, useState } from "react";
import type { SeriesPoint } from "@/lib/types";
import { formatMs } from "@/lib/format";

/**
 * Response-time chart: p50 and p95, one y-axis, 2px lines, recessive grid,
 * direct labels at the line ends + a legend, crosshair tooltip on hover/keyboard,
 * and a visually-hidden table for screen readers.
 */
export function ResponseChart({ series, height = 180, title = "Response time, last 24h" }: { series: SeriesPoint[]; height?: number; title?: string }) {
  const W = 640;
  const H = height;
  const pad = { l: 44, r: 44, t: 12, b: 24 };
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const pts = series.filter((s) => s.p50 !== null || s.p95 !== null);
  const { yMax, ticks, x, y } = useMemo(() => {
    const max = Math.max(1, ...pts.map((p) => Math.max(p.p95 ?? 0, p.p50 ?? 0)));
    const step = niceStep(max / 3);
    const yMax = Math.ceil(max / step) * step;
    const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
    const x = (i: number) => pad.l + (pts.length <= 1 ? 0 : (i / (pts.length - 1)) * (W - pad.l - pad.r));
    const y = (v: number) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);
    return { yMax, ticks, x, y };
  }, [pts, H, pad.l, pad.r, pad.t, pad.b]);

  if (pts.length < 2) {
    return <div className="grid h-[120px] place-items-center rounded-[10px] border border-dashed border-line text-[14px] text-muted">Not enough runs yet to chart response times.</div>;
  }

  const line = (key: "p50" | "p95") =>
    pts.map((p, i) => (p[key] === null ? null : `${x(i).toFixed(1)},${y(p[key]!).toFixed(1)}`)).filter(Boolean).join(" ");

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (pts.length - 1));
    setHover(Math.max(0, Math.min(pts.length - 1, i)));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? pts.length) - 1));
    if (e.key === "ArrowRight") setHover((h) => Math.min(pts.length - 1, (h ?? -1) + 1));
    if (e.key === "Escape") setHover(null);
  };

  const last = pts[pts.length - 1]!;
  const h = hover !== null ? pts[hover]! : null;
  const hourLabel = (t: string) => new Date(t).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });

  return (
    <figure className="relative">
      <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[14px] font-medium text-ink">{title}</span>
        <ul className="flex items-center gap-4 text-[12px] text-muted" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span className="h-[2px] w-4 rounded bg-ink/70" aria-hidden="true" /> p50
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-[2px] w-4 rounded bg-coral" aria-hidden="true" /> p95
          </li>
        </ul>
      </figcaption>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none rounded-[8px] focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
        role="img"
        aria-label={`${title}. Latest p50 ${formatMs(last.p50)}, p95 ${formatMs(last.p95)}. Use arrow keys to inspect.`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgb(var(--line))" strokeWidth="1" />
            <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
              {formatMs(t)}
            </text>
          </g>
        ))}
        {[0, Math.floor((pts.length - 1) / 2), pts.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"} className="fill-muted text-[11px]">
            {hourLabel(pts[i]!.t)}
          </text>
        ))}
        <polyline points={line("p50")} fill="none" stroke="rgb(var(--ink) / 0.7)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={line("p95")} fill="none" stroke="rgb(var(--coral))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* direct labels at line ends */}
        {last.p95 !== null && (
          <text x={W - pad.r + 6} y={y(last.p95)} dy="0.32em" className="fill-muted text-[11px] font-medium">p95</text>
        )}
        {last.p50 !== null && (
          <text x={W - pad.r + 6} y={Math.max(y(last.p50), (last.p95 !== null ? y(last.p95) : 0) + 12)} dy="0.32em" className="fill-muted text-[11px] font-medium">p50</text>
        )}
        {h && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="rgb(var(--muted) / 0.5)" strokeWidth="1" strokeDasharray="3 3" />
            {h.p50 !== null && <circle cx={x(hover)} cy={y(h.p50)} r="4" fill="rgb(var(--ink))" stroke="rgb(var(--card))" strokeWidth="2" />}
            {h.p95 !== null && <circle cx={x(hover)} cy={y(h.p95)} r="4" fill="rgb(var(--coral))" stroke="rgb(var(--card))" strokeWidth="2" />}
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-8 z-10 rounded-[10px] border border-line bg-card px-3 py-2 text-[12px] shadow-soft"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > pts.length / 2 ? "calc(-100% - 12px)" : "12px"})` }}
        >
          <div className="font-medium text-ink">{hourLabel(h.t)} UTC</div>
          <div className="mt-1 flex items-center gap-2 text-muted"><span className="h-[2px] w-3 bg-ink/70" aria-hidden="true" />p50 <span className="ml-auto tabular-nums text-ink">{formatMs(h.p50)}</span></div>
          <div className="flex items-center gap-2 text-muted"><span className="h-[2px] w-3 bg-coral" aria-hidden="true" />p95 <span className="ml-auto pl-3 tabular-nums text-ink">{formatMs(h.p95)}</span></div>
        </div>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th>Hour (UTC)</th><th>p50</th><th>p95</th></tr></thead>
        <tbody>{pts.map((p) => <tr key={p.t}><td>{hourLabel(p.t)}</td><td>{formatMs(p.p50)}</td><td>{formatMs(p.p95)}</td></tr>)}</tbody>
      </table>
      <span className="sr-only">Maximum on chart: {formatMs(yMax)}</span>
    </figure>
  );
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}
