/**
 * Incident state machine.
 *
 * A check is only marked DOWN after `failureThreshold` consecutive failed runs,
 * and only RECOVERED after `recoveryThreshold` consecutive passing runs. A single
 * blip (one failed run between passes) never opens an incident, which is the
 * main defence against false alarms alongside in-run retries.
 *
 * This function is pure: the worker computes the transition here and the
 * database applies it atomically (see `record_run` in the migrations), guarded
 * by an optimistic `state_version` so two workers can never both open an incident.
 */

export type CheckState = "unknown" | "up" | "down";
export type Transition = "opened" | "resolved" | null;

export interface CheckCounters {
  state: CheckState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export interface TransitionResult extends CheckCounters {
  transition: Transition;
}

export interface ThresholdOptions {
  failureThreshold?: number;
  recoveryThreshold?: number;
}

export const DEFAULT_FAILURE_THRESHOLD = 2;
export const DEFAULT_RECOVERY_THRESHOLD = 2;

export const INITIAL_COUNTERS: CheckCounters = {
  state: "unknown",
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
};

export function nextState(
  prev: CheckCounters,
  ok: boolean,
  opts: ThresholdOptions = {},
): TransitionResult {
  const failureThreshold = Math.max(1, opts.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD);
  const recoveryThreshold = Math.max(1, opts.recoveryThreshold ?? DEFAULT_RECOVERY_THRESHOLD);

  if (ok) {
    const consecutiveSuccesses = prev.consecutiveSuccesses + 1;
    if (prev.state === "down") {
      if (consecutiveSuccesses >= recoveryThreshold) {
        return { state: "up", consecutiveFailures: 0, consecutiveSuccesses, transition: "resolved" };
      }
      return { state: "down", consecutiveFailures: 0, consecutiveSuccesses, transition: null };
    }
    // unknown -> up on the first pass: there is no incident to resolve.
    return { state: "up", consecutiveFailures: 0, consecutiveSuccesses, transition: null };
  }

  const consecutiveFailures = prev.consecutiveFailures + 1;
  if (prev.state !== "down" && consecutiveFailures >= failureThreshold) {
    return { state: "down", consecutiveFailures, consecutiveSuccesses: 0, transition: "opened" };
  }
  return { state: prev.state, consecutiveFailures, consecutiveSuccesses: 0, transition: null };
}

/** Replay a sequence of results from a starting state. Handy for tests and backfills. */
export function replay(
  results: boolean[],
  start: CheckCounters = INITIAL_COUNTERS,
  opts?: ThresholdOptions,
): { final: CheckCounters; transitions: { index: number; transition: Exclude<Transition, null> }[] } {
  let cur: CheckCounters = start;
  const transitions: { index: number; transition: Exclude<Transition, null> }[] = [];
  results.forEach((ok, index) => {
    const r = nextState(cur, ok, opts);
    if (r.transition) transitions.push({ index, transition: r.transition });
    cur = { state: r.state, consecutiveFailures: r.consecutiveFailures, consecutiveSuccesses: r.consecutiveSuccesses };
  });
  return { final: cur, transitions };
}
