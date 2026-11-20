"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { getSupabase } from "@/lib/supabase";
import { useSession } from "@/lib/data";

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { session, ready } = useSession();
  const nav = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/checks/new", label: "New check" },
    { href: "/status/demo", label: "Status page" },
  ];

  const signOut = async () => {
    await getSupabase()?.auth.signOut();
    router.refresh();
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Logo href="/dashboard" />
            <nav aria-label="Dashboard" className="hidden items-center gap-1 sm:flex">
              {nav.map((n) => {
                const active = n.href === "/dashboard" ? path === n.href : path.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-full px-3 py-1.5 text-[14px] transition-colors ${active ? "bg-card text-ink shadow-soft" : "text-muted hover:text-ink"}`}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {ready &&
              (session ? (
                <button type="button" onClick={signOut} className="pill-outline !px-4 !py-2 text-[14px]">
                  Sign out
                </button>
              ) : (
                <Link href="/login" className="pill-dark !px-4 !py-2 text-[14px]">
                  Sign in
                </Link>
              ))}
          </div>
        </div>
        <nav aria-label="Dashboard mobile" className="flex gap-1 overflow-x-auto px-4 pb-2 sm:hidden">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="shrink-0 rounded-full px-3 py-1.5 text-[14px] text-muted">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}

export function DemoNotice() {
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-card border border-dashed border-line bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[14px] text-muted">
        <span className="font-medium text-ink">You&apos;re looking at demo data.</span> Sign in to create checks for your own sites.
      </p>
      <Link href="/login" className="pill-primary !py-2 text-[14px]">Sign in to start</Link>
    </div>
  );
}
