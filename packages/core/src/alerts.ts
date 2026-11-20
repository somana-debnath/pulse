/**
 * Alert fan-out with exactly-once-per-channel semantics.
 *
 * Every (incident, kind, channel) triple gets a deterministic dedup key. Before
 * sending, a dispatcher must *claim* the key in a store (the `alerts` table's
 * unique constraint in production). Only the claimer sends. If the send fails
 * the claim is released so the next run can retry — so a retried job, two
 * overlapping workers, or a replayed run never double-notify, and a transient
 * Discord/SMTP error never silently drops an alert.
 */

export type AlertKind = "opened" | "resolved";
export type AlertChannel = "discord" | "email";

export interface AlertEvent {
  kind: AlertKind;
  incidentId: string;
  checkId: string;
  checkName: string;
  projectName: string;
  projectSlug: string;
  url: string | null;
  startedAt: string;
  resolvedAt?: string | null;
  durationMs?: number | null;
  failingStep?: string | null;
  error?: string | null;
  screenshot?: { url?: string | null; png?: Uint8Array | null } | null;
  statusPageUrl?: string | null;
}

export interface Notifier {
  channel: AlertChannel;
  send(event: AlertEvent): Promise<void>;
}

export interface AlertStore {
  /** Atomically claim a key. Resolves true only for the first caller. */
  claim(key: string, meta: { incidentId: string; kind: AlertKind; channel: AlertChannel }): Promise<boolean>;
  markSent(key: string): Promise<void>;
  /** Give the key back after a failed send so it can be retried. */
  release(key: string, error: string): Promise<void>;
}

export function alertDedupKey(incidentId: string, kind: AlertKind, channel: AlertChannel): string {
  return `${incidentId}:${kind}:${channel}`;
}

export interface DispatchOutcome {
  channel: AlertChannel;
  key: string;
  status: "sent" | "duplicate" | "failed";
  error?: string;
}

export async function dispatchAlert(
  event: AlertEvent,
  notifiers: Notifier[],
  store: AlertStore,
): Promise<DispatchOutcome[]> {
  return Promise.all(
    notifiers.map(async (n): Promise<DispatchOutcome> => {
      const key = alertDedupKey(event.incidentId, event.kind, n.channel);
      const claimed = await store.claim(key, { incidentId: event.incidentId, kind: event.kind, channel: n.channel });
      if (!claimed) return { channel: n.channel, key, status: "duplicate" };
      try {
        await n.send(event);
        await store.markSent(key);
        return { channel: n.channel, key, status: "sent" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await store.release(key, message);
        return { channel: n.channel, key, status: "failed", error: message };
      }
    }),
  );
}

/** In-memory store, used by tests and by the worker when no database is configured. */
export class MemoryAlertStore implements AlertStore {
  readonly claimed = new Map<string, "pending" | "sent">();
  readonly failures: { key: string; error: string }[] = [];

  async claim(key: string): Promise<boolean> {
    if (this.claimed.has(key)) return false;
    this.claimed.set(key, "pending");
    return true;
  }
  async markSent(key: string): Promise<void> {
    this.claimed.set(key, "sent");
  }
  async release(key: string, error: string): Promise<void> {
    this.claimed.delete(key);
    this.failures.push({ key, error });
  }
}
