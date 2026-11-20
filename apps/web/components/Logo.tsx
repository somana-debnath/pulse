import Link from "next/link";

export function HeartbeatIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <path d="M2.5 12.5h4l2-5 3.5 10 2.5-7.5 1.5 2.5h5.5" stroke="rgb(var(--coral))" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2 rounded-lg" aria-label="Pulse home">
      <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-dark transition-transform duration-300 group-hover:scale-105">
        <HeartbeatIcon className="h-5 w-5" />
      </span>
      <span className="serif text-[26px] leading-none">Pulse</span>
    </Link>
  );
}
