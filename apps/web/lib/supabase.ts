import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The web app only ever uses the *publishable* key. Every table has RLS, so the
 * browser can read only what the signed-in user owns, and the public status page
 * goes through the curated security-definer RPC status_page(slug).
 * The secret key lives exclusively in the worker's environment.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && key);

let browserClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  if (typeof window === "undefined") {
    // server: stateless client per call (no session)
    return createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  browserClient ??= createClient(url!, key!, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" } });
  return browserClient;
}
