import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  dispatchAlert,
  isDue,
  mapLimit,
  nextState,
  runIdempotencyKey,
  slotStart,
  type AlertEvent,
  type DispatchOutcome,
  type Notifier,
  type RunResult,
} from "@pulse/core";
import { StateConflictError, type CheckWithProject, type RecordRunOutput, type Store } from "./store/types";

export interface EngineDeps {
  store: Store;
  notifiers: Notifier[];
  run: (check: CheckWithProject) => Promise<RunResult>;
  now?: () => Date;
  region?: string;
  publicAppUrl?: string;
  artifactsDir?: string;
  log?: (msg: string) => void;
}

export interface ProcessOutcome {
  checkId: string;
  name: string;
  result: RunResult;
  recorded: RecordRunOutput;
  alerts: DispatchOutcome[];
}

/** Run one check for the current slot and record it. Safe to call repeatedly: duplicates are no-ops. */
export async function processCheck(check: CheckWithProject, deps: EngineDeps): Promise<ProcessOutcome> {
  const log = deps.log ?? (() => {});
  const now = deps.now?.() ?? new Date();
  const slot = slotStart(now, check.interval_minutes);
  const idempotencyKey = runIdempotencyKey(check.id, slot);

  const result = await deps.run(check);

  // Upload failure screenshots (best-effort) and optionally keep a local copy (CI artifacts).
  const keyHash = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 16);
  const shotUrls = new Map<number, string | null>();
  for (const s of result.steps) {
    if (!s.screenshot) continue;
    const path = `${check.id}/${keyHash}/step-${s.index}.png`;
    shotUrls.set(s.index, await deps.store.uploadScreenshot(path, s.screenshot).catch(() => null));
    if (deps.artifactsDir) {
      const dir = join(deps.artifactsDir, check.project.slug);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${check.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${keyHash}.png`), s.screenshot);
    }
  }
  const failing = result.steps.find((s) => !s.ok) ?? null;

  // Apply the state transition; on optimistic-lock conflict, re-read and recompute.
  let current = check;
  let recorded: RecordRunOutput | null = null;
  for (let attempt = 1; attempt <= 3 && !recorded; attempt++) {
    const next = nextState(
      { state: current.state, consecutiveFailures: current.consecutive_failures, consecutiveSuccesses: current.consecutive_successes },
      result.ok,
    );
    try {
      recorded = await deps.store.recordRun({
        checkId: check.id,
        idempotencyKey,
        slot,
        run: {
          started_at: result.startedAt,
          finished_at: result.finishedAt,
          ok: result.ok,
          duration_ms: result.durationMs,
          status_code: result.statusCode ?? null,
          error: result.error ?? null,
          attempts: result.attempts,
          region: deps.region ?? "local",
        },
        steps: result.steps.map((s) => ({
          idx: s.index,
          name: s.name,
          ok: s.ok,
          duration_ms: s.durationMs,
          error: s.error ?? null,
          screenshot_url: shotUrls.get(s.index) ?? null,
        })),
        expectedVersion: current.state_version,
        next: { state: next.state, consecutiveFailures: next.consecutiveFailures, consecutiveSuccesses: next.consecutiveSuccesses },
        transition: next.transition,
        failingStep: failing?.name ?? null,
        error: result.error ?? null,
        screenshotUrl: failing ? (shotUrls.get(failing.index) ?? null) : null,
      });
    } catch (err) {
      if (!(err instanceof StateConflictError) || attempt === 3) throw err;
      log(`  ⟳ ${check.name}: state changed concurrently, re-reading`);
      current = (await deps.store.getCheck(check.id)) ?? current;
    }
  }

  const rec = recorded!;
  const icon = result.ok ? "✓" : "✗";
  log(
    `${icon} ${check.project.name} / ${check.name}  ${result.durationMs}ms${result.attempts > 1 ? ` (${result.attempts} attempts)` : ""}` +
      `${result.error ? `  — ${result.error}` : ""}${rec.duplicate ? "  [duplicate slot, ignored]" : ""}${rec.transition ? `  → incident ${rec.transition}` : ""}`,
  );

  let alerts: DispatchOutcome[] = [];
  if (!rec.duplicate && rec.transition && rec.incidentId && deps.notifiers.length) {
    const inc = await deps.store.getIncident(rec.incidentId);
    const event: AlertEvent = {
      kind: rec.transition,
      incidentId: rec.incidentId,
      checkId: check.id,
      checkName: check.name,
      projectName: check.project.name,
      projectSlug: check.project.slug,
      url: check.url,
      startedAt: inc?.started_at ?? result.startedAt,
      resolvedAt: inc?.resolved_at ?? null,
      durationMs: inc?.resolved_at ? Date.parse(inc.resolved_at) - Date.parse(inc.started_at) : null,
      failingStep: failing?.name ?? inc?.failing_step ?? null,
      error: result.error ?? null,
      screenshot: failing?.screenshot ? { png: failing.screenshot, url: shotUrls.get(failing.index) ?? null } : null,
      statusPageUrl: deps.publicAppUrl ? `${deps.publicAppUrl}/status/${check.project.slug}` : null,
    };
    alerts = await dispatchAlert(event, deps.notifiers, deps.store.alerts);
    for (const a of alerts) log(`    ✉ ${a.channel}: ${a.status}${a.error ? ` (${a.error})` : ""}`);
  }

  return { checkId: check.id, name: check.name, result, recorded: rec, alerts };
}

/** One scheduler tick: run every enabled check that has no run in its current slot. */
export async function tick(deps: EngineDeps & { concurrency?: number; force?: boolean }): Promise<ProcessOutcome[]> {
  const now = deps.now?.() ?? new Date();
  const checks = await deps.store.listEnabledChecks();
  const due = deps.force ? checks : checks.filter((c) => isDue(c.last_slot, c.interval_minutes, now));
  deps.log?.(`Pulse tick @ ${now.toISOString()} — ${due.length}/${checks.length} checks due (${deps.store.name} store)`);

  const outcomes = await mapLimit(due, deps.concurrency ?? 4, (c) =>
    processCheck(c, deps).catch((err) => {
      deps.log?.(`! ${c.name}: ${(err as Error).message}`);
      return null;
    }),
  );

  // Retry alerts whose delivery failed on a previous tick.
  if (deps.notifiers.length) {
    for (const event of await deps.store.failedAlertEvents(deps.publicAppUrl ?? "")) {
      const out = await dispatchAlert(event, deps.notifiers, deps.store.alerts);
      for (const a of out.filter((o) => o.status !== "duplicate")) deps.log?.(`    ✉ retry ${a.channel}: ${a.status}`);
    }
  }
  return outcomes.filter((o): o is ProcessOutcome => o !== null);
}
