"use client";
import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { Logo } from "@/components/Logo";
import { HeartbeatLine } from "@/components/HeartbeatLine";
import { getSupabase, supabaseConfigured } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    const { error } = await getSupabase()!.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/dashboard` } });
    if (error) {
      setError(error.message);
      setState("error");
    } else setState("sent");
  };

  return (
    <main id="main" className="grid min-h-screen place-items-center px-4">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <div className="card p-6">
          <h1 className="serif text-[34px] leading-tight">Sign in</h1>
          <p className="mt-1 text-[15px] text-muted">We&apos;ll email you a magic link. No password needed.</p>
          {!supabaseConfigured ? (
            <p className="mt-6 rounded-[10px] bg-warn-soft px-3 py-2 text-[14px] text-warn-ink">Supabase isn&apos;t configured. Add the URL and publishable key to .env.local.</p>
          ) : state === "sent" ? (
            <p role="status" className="mt-6 rounded-[10px] bg-up-soft px-3 py-3 text-[14px] text-up-ink">Check <b>{email}</b> for your sign-in link.</p>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-3">
              <label htmlFor="email" className="label">Email</label>
              <input id="email" type="email" required autoComplete="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              {state === "error" && <p role="alert" className="text-[13px] text-down-ink">{error}</p>}
              <button className="pill-primary w-full" disabled={state === "sending"}>
                {state === "sending" ? "Sending…" : "Send magic link"}
              </button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-[14px] text-muted">
          Just looking? <Link href="/dashboard" className="text-coral-ink underline-offset-2 hover:underline">Explore the demo</Link>
        </p>
        <HeartbeatLine className="mt-8 h-10 w-full opacity-60" />
      </motion.div>
    </main>
  );
}
