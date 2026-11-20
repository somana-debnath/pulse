/** Coral ECG trace that draws itself on a loop (CSS; frozen fully-drawn under reduced motion). */
export function HeartbeatLine({ className = "" }: { className?: string }) {
  const d =
    "M0 40 H120 L135 40 L145 28 L155 40 H230 L242 40 L252 8 L266 72 L278 22 L288 40 H380 L392 40 L400 32 L410 40 H520 L532 40 L542 12 L556 66 L568 26 L578 40 H700";
  return (
    <svg viewBox="0 0 700 80" preserveAspectRatio="none" className={className} aria-hidden="true">
      <path d={d} fill="none" stroke="rgb(var(--coral) / 0.14)" strokeWidth="2" strokeLinejoin="round" />
      <path d={d} pathLength={1} className="heartbeat-path" fill="none" stroke="rgb(var(--coral))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
