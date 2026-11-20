import { randomUUID } from "node:crypto";
import { MemoryAlertStore } from "@pulse/core";
import { StateConflictError, type CheckWithProject, type IncidentRow, type RecordRunInput, type RecordRunOutput, type Store } from "./types";

interface MemRun {
  id: string;
  check_id: string;
  idempotency_key: string;
  started_at: string;
  ok: boolean;
  duration_ms: number;
  steps: RecordRunInput["steps"];
}

/**
 * In-memory Store that mirrors supabase/migrations/0004_record_run.sql exactly:
 * idempotent insert, optimistic state_version check, incident start = first failure
 * of the streak, resolve = first pass of the recovery streak.
 */
export class MemoryStore implements Store {
  readonly name = "memory";
  readonly checks = new Map<string, CheckWithProject>();
  readonly runs: MemRun[] = [];
  readonly incidents: IncidentRow[] = [];
  readonly screenshots = new Map<string, Uint8Array>();
  readonly alerts = new MemoryAlertStore();

  constructor(checks: CheckWithProject[] = []) {
    for (const c of checks) this.checks.set(c.id, structuredClone(c));
  }

  async listEnabledChecks() {
    return [...this.checks.values()].filter((c) => c.enabled).map((c) => structuredClone(c));
  }

  async getCheck(id: string) {
    const c = this.checks.get(id);
    return c ? structuredClone(c) : null;
  }

  async recordRun(input: RecordRunInput): Promise<RecordRunOutput> {
    const existing = this.runs.find((r) => r.idempotency_key === input.idempotencyKey);
    if (existing) return { duplicate: true, runId: existing.id, transition: null, incidentId: null };

    const check = this.checks.get(input.checkId);
    if (!check) throw new Error(`Unknown check ${input.checkId}`);
    if (check.state_version !== input.expectedVersion) throw new StateConflictError(input.checkId);

    const run: MemRun = {
      id: randomUUID(),
      check_id: input.checkId,
      idempotency_key: input.idempotencyKey,
      started_at: input.run.started_at,
      ok: input.run.ok,
      duration_ms: input.run.duration_ms,
      steps: input.steps,
    };
    this.runs.push(run);

    Object.assign(check, {
      state: input.next.state,
      consecutive_failures: input.next.consecutiveFailures,
      consecutive_successes: input.next.consecutiveSuccesses,
      state_version: check.state_version + 1,
      last_slot: input.slot.toISOString(),
      last_run_at: input.run.started_at,
    });

    const mine = this.runs.filter((r) => r.check_id === input.checkId);
    const streakStart = (ok: boolean) => {
      const lastOpposite = mine.filter((r) => r.ok !== ok).map((r) => r.started_at).sort().at(-1) ?? "";
      return mine.filter((r) => r.ok === ok && r.started_at > lastOpposite).map((r) => r.started_at).sort()[0] ?? input.run.started_at;
    };

    let incidentId: string | null = null;
    if (input.transition === "opened" && !this.incidents.some((i) => i.check_id === input.checkId && !i.resolved_at)) {
      const inc: IncidentRow = {
        id: randomUUID(),
        check_id: input.checkId,
        started_at: streakStart(false),
        resolved_at: null,
        failing_step: input.failingStep,
        error: input.error,
        screenshot_url: input.screenshotUrl,
      };
      this.incidents.push(inc);
      incidentId = inc.id;
    } else if (input.transition === "resolved") {
      const open = this.incidents.find((i) => i.check_id === input.checkId && !i.resolved_at);
      if (open) {
        const s = streakStart(true);
        open.resolved_at = s > open.started_at ? s : open.started_at;
        incidentId = open.id;
      }
    }
    return { duplicate: false, runId: run.id, transition: incidentId ? input.transition : null, incidentId };
  }

  async getIncident(id: string) {
    return this.incidents.find((i) => i.id === id) ?? null;
  }

  async uploadScreenshot(path: string, png: Uint8Array) {
    this.screenshots.set(path, png);
    return `memory://${path}`;
  }

  async failedAlertEvents() {
    return [];
  }
}
