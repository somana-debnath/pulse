import type { AlertEvent, AlertStore, CheckRow, CheckState } from "@pulse/core";

export interface CheckWithProject extends CheckRow {
  project: { id: string; name: string; slug: string };
}

export interface RecordRunInput {
  checkId: string;
  idempotencyKey: string;
  slot: Date;
  run: {
    started_at: string;
    finished_at: string;
    ok: boolean;
    duration_ms: number;
    status_code: number | null;
    error: string | null;
    attempts: number;
    region: string;
  };
  steps: { idx: number; name: string; ok: boolean; duration_ms: number; error: string | null; screenshot_url: string | null }[];
  expectedVersion: number;
  next: { state: CheckState; consecutiveFailures: number; consecutiveSuccesses: number };
  transition: "opened" | "resolved" | null;
  failingStep: string | null;
  error: string | null;
  screenshotUrl: string | null;
}

export interface RecordRunOutput {
  duplicate: boolean;
  runId: string;
  transition: "opened" | "resolved" | null;
  incidentId: string | null;
}

export interface IncidentRow {
  id: string;
  check_id: string;
  started_at: string;
  resolved_at: string | null;
  failing_step: string | null;
  error: string | null;
  screenshot_url: string | null;
}

export class StateConflictError extends Error {
  constructor(checkId: string) {
    super(`state_conflict on check ${checkId}`);
    this.name = "StateConflictError";
  }
}

export interface Store {
  readonly name: string;
  listEnabledChecks(): Promise<CheckWithProject[]>;
  getCheck(id: string): Promise<CheckWithProject | null>;
  recordRun(input: RecordRunInput): Promise<RecordRunOutput>;
  getIncident(id: string): Promise<IncidentRow | null>;
  uploadScreenshot(path: string, png: Uint8Array): Promise<string | null>;
  /** Alert events whose delivery previously failed, to be retried. */
  failedAlertEvents(publicAppUrl: string): Promise<AlertEvent[]>;
  alerts: AlertStore;
}
