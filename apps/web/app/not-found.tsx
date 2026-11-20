import Link from "next/link";
import { HeartbeatLine } from "@/components/HeartbeatLine";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-screen place-items-center px-4 text-center">
      <div>
        <h1 className="serif text-[64px] leading-none">Flatline.</h1>
        <p className="mt-3 text-muted">We couldn&apos;t find that page or status page.</p>
        <HeartbeatLine className="mx-auto my-8 h-12 w-72" />
        <Link href="/" className="pill-dark">Back to Pulse</Link>
      </div>
    </main>
  );
}
