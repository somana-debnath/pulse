import type { DisplayState } from "@/lib/types";

const META: Record<DisplayState, { dot: string; text: string; soft: string; label: string }> = {
  up: { dot: "bg-up", text: "text-up-ink", soft: "bg-up-soft", label: "Operational" },
  degraded: { dot: "bg-warn", text: "text-warn-ink", soft: "bg-warn-soft", label: "Degraded" },
  down: { dot: "bg-down", text: "text-down-ink", soft: "bg-down-soft", label: "Down" },
  unknown: { dot: "bg-none", text: "text-muted", soft: "bg-line/60", label: "Pending" },
  paused: { dot: "bg-none", text: "text-muted", soft: "bg-line/60", label: "Paused" },
};

export function StatusDot({ state, pulse = false }: { state: DisplayState; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden="true">
      <span className={`relative h-2.5 w-2.5 rounded-full ${META[state].dot} ${pulse && state === "up" ? "ping-dot" : ""}`} />
    </span>
  );
}

export function StatusPill({ state, label }: { state: DisplayState; label?: string }) {
  const m = META[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${m.soft} ${m.text}`}>
      <StatusDot state={state} />
      {label ?? m.label}
    </span>
  );
}

/** Overall status hero, e.g. "All systems operational" in a soft green banner. */
export function StatusBanner({ states, updated }: { states: DisplayState[]; updated?: string }) {
  const down = states.filter((s) => s === "down").length;
  const overall: DisplayState = down === 0 ? "up" : down === states.length ? "down" : "degraded";
  const title =
    states.length === 0
      ? "No checks yet"
      : overall === "up"
        ? "All systems operational"
        : overall === "down"
          ? "Major outage"
          : `${down} ${down === 1 ? "check is" : "checks are"} failing`;
  const m = META[states.length === 0 ? "unknown" : overall];
  return (
    <div className={`flex flex-col gap-1 rounded-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${m.soft}`} role="status">
      <div className={`flex items-center gap-3 ${m.text}`}>
        <span className="relative inline-flex h-3 w-3" aria-hidden="true">
          <span className={`relative h-3 w-3 rounded-full ${m.dot} ${overall === "up" && states.length ? "ping-dot" : ""}`} />
        </span>
        <span className="text-[17px] font-semibold">{title}</span>
      </div>
      {updated && <span className={`text-[13px] ${m.text} opacity-90`}>{updated}</span>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "up" | "down" }) {
  return (
    <div className="card p-5">
      <div className="text-[13px] text-muted">{label}</div>
      <div className={`serif mt-1 text-[40px] leading-none tabular-nums ${tone === "down" ? "text-down-ink" : ""}`}>{value}</div>
      {hint && <div className="mt-2 text-[13px] text-muted">{hint}</div>}
    </div>
  );
}
