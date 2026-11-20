"use client";
import Link from "next/link";
import { CheckEditor } from "@/components/CheckEditor";
import { DemoNotice } from "@/components/AppShell";
import { useSession } from "@/lib/data";

export default function NewCheckPage() {
  const { session, ready } = useSession();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/dashboard" className="text-[14px] text-muted hover:text-ink">← Overview</Link>
      <h1 className="serif mt-3 text-[44px] leading-none">New check</h1>
      <p className="mb-6 mt-2 text-[15px] text-muted">Ping a URL, or describe a journey a real user takes through your site.</p>
      {ready && !session && <DemoNotice />}
      {ready && <CheckEditor readOnly={!session} />}
    </div>
  );
}
