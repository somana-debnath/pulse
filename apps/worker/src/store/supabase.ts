import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AlertChannel, AlertEvent, AlertKind, AlertStore } from "@pulse/core";
import { StateConflictError, type CheckWithProject, type IncidentRow, type RecordRunInput, type RecordRunOutput, type Store } from "./types";

/**
 * Server-side store. Uses the Supabase *secret* key (service_role), which bypasses
 * RLS — it must only ever exist in the worker's environment (.env.local / GitHub
 * Actions secrets), never in the Next.js app.
 */
export class SupabaseStore implements Store {
  readonly name = "supabase";
  private readonly db: SupabaseClient;
  readonly alerts: AlertStore;

  constructor(url: string, secretKey: string) {
    this.db = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const db = this.db;
    this.alerts = {
      async claim(key, meta) {
        const { data, error } = await db.rpc("claim_alert", { p_key: key, p_incident_id: meta.incidentId, p_kind: meta.kind, p_channel: meta.channel });
        if (error) throw new Error(`claim_alert: ${error.message}`);
        return data === true;
      },
      async markSent(key) {
        const { error } = await db.rpc("finish_alert", { p_key: key, p_ok: true });
        if (error) throw new Error(`finish_alert: ${error.message}`);
      },
      async release(key, message) {
        const { error } = await db.rpc("finish_alert", { p_key: key, p_ok: false, p_error: message.slice(0, 1000) });
        if (error) throw new Error(`finish_alert: ${error.message}`);
      },
    };
  }

  private static readonly SELECT = "*, project:projects!inner(id, name, slug)";

  async listEnabledChecks(): Promise<CheckWithProject[]> {
    const { data, error } = await this.db.from("checks").select(SupabaseStore.SELECT).eq("enabled", true);
    if (error) throw new Error(`list checks: ${error.message}`);
    return (data ?? []) as CheckWithProject[];
  }

  async getCheck(id: string): Promise<CheckWithProject | null> {
    const { data, error } = await this.db.from("checks").select(SupabaseStore.SELECT).eq("id", id).maybeSingle();
    if (error) throw new Error(`get check: ${error.message}`);
    return data as CheckWithProject | null;
  }

  async recordRun(i: RecordRunInput): Promise<RecordRunOutput> {
    const { data, error } = await this.db.rpc("record_run", {
      p_check_id: i.checkId,
      p_idempotency_key: i.idempotencyKey,
      p_slot: i.slot.toISOString(),
      p_run: i.run,
      p_steps: i.steps,
      p_expected_version: i.expectedVersion,
      p_next_state: i.next.state,
      p_next_failures: i.next.consecutiveFailures,
      p_next_successes: i.next.consecutiveSuccesses,
      p_transition: i.transition,
      p_failing_step: i.failingStep,
      p_error: i.error,
      p_screenshot_url: i.screenshotUrl,
    });
    if (error) {
      if (error.code === "40001" || error.message.includes("state_conflict")) throw new StateConflictError(i.checkId);
      throw new Error(`record_run: ${error.message}`);
    }
    const r = data as { duplicate: boolean; run_id: string; transition: RecordRunOutput["transition"]; incident_id: string | null };
    return { duplicate: r.duplicate, runId: r.run_id, transition: r.transition, incidentId: r.incident_id ?? null };
  }

  async getIncident(id: string): Promise<IncidentRow | null> {
    const { data, error } = await this.db.from("incidents").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`get incident: ${error.message}`);
    return data as IncidentRow | null;
  }

  async uploadScreenshot(path: string, png: Uint8Array): Promise<string | null> {
    const { error } = await this.db.storage.from("screenshots").upload(path, png, { contentType: "image/png", upsert: true });
    if (error) return null; // screenshots are best-effort; never fail a run over them
    return this.db.storage.from("screenshots").getPublicUrl(path).data.publicUrl;
  }

  async failedAlertEvents(publicAppUrl: string): Promise<AlertEvent[]> {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data, error } = await this.db
      .from("alerts")
      .select("kind, channel, attempts, incident:incidents!inner(*, check:checks!inner(id, name, url, project:projects!inner(name, slug)))")
      .eq("status", "failed")
      .lt("attempts", 5)
      .gte("created_at", since);
    if (error || !data) return [];
    type Row = {
      kind: AlertKind;
      channel: AlertChannel;
      incident: IncidentRow & { check: { id: string; name: string; url: string | null; project: { name: string; slug: string } } };
    };
    return (data as unknown as Row[]).map(({ kind, incident: inc }) => ({
      kind,
      incidentId: inc.id,
      checkId: inc.check.id,
      checkName: inc.check.name,
      projectName: inc.check.project.name,
      projectSlug: inc.check.project.slug,
      url: inc.check.url,
      startedAt: inc.started_at,
      resolvedAt: inc.resolved_at,
      durationMs: inc.resolved_at ? Date.parse(inc.resolved_at) - Date.parse(inc.started_at) : null,
      failingStep: inc.failing_step,
      error: inc.error,
      screenshot: inc.screenshot_url ? { url: inc.screenshot_url } : null,
      statusPageUrl: `${publicAppUrl}/status/${inc.check.project.slug}`,
    }));
  }
}
