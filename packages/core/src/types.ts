import type { CheckState } from "./incident";
import type { JourneyStep } from "./journey";

export type CheckType = "http" | "browser";

/** A check as stored in the `checks` table (snake_case mirrors the DB). */
export interface CheckRow {
  id: string;
  project_id: string;
  name: string;
  type: CheckType;
  url: string | null;
  method: string;
  expected_status: number;
  max_response_ms: number | null;
  steps: JourneyStep[] | null;
  script: string | null;
  interval_minutes: number;
  timeout_ms: number;
  retries: number;
  enabled: boolean;
  state: CheckState;
  consecutive_failures: number;
  consecutive_successes: number;
  state_version: number;
  last_slot: string | null;
  last_run_at: string | null;
  created_at: string;
}

export interface StepResult {
  index: number;
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string | null;
  screenshot?: Uint8Array | null;
  screenshotUrl?: string | null;
}

export interface RunResult {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  statusCode?: number | null;
  error?: string | null;
  attempts: number;
  steps: StepResult[];
}
