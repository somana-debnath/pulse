import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { demoStatusPage } from "@/lib/demo";
import type { StatusPageData } from "@/lib/types";
import { StatusPageView } from "@/components/StatusPageView";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

export const revalidate = 60;

async function load(slug: string): Promise<{ data: StatusPageData; demo: boolean } | null> {
  const sb = getSupabase();
  if (sb && slug !== "demo") {
    const { data, error } = await sb.rpc("status_page", { p_slug: slug });
    if (!error && data) return { data: data as StatusPageData, demo: false };
  }
  // Fallback: demo data (for /status/demo, or before migrations/seed have been applied).
  const demo = demoStatusPage(slug);
  return demo ? { data: demo, demo: true } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const r = await load(slug);
  return { title: r ? `${r.data.project.name} status` : "Status" };
}

export default async function StatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await load(slug);
  if (!r) notFound();

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 pb-20 pt-6 sm:px-6">
        <StatusPageView data={r.data} demo={r.demo} />
        <p className="mt-12 text-center text-[13px] text-muted">
          Powered by <Link href="/" className="text-coral-ink underline-offset-2 hover:underline">Pulse</Link> · open-source synthetic monitoring
        </p>
      </main>
    </div>
  );
}
