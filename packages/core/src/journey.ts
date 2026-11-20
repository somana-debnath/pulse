/**
 * Declarative Playwright journeys.
 *
 * Journeys are stored as JSON in `checks.steps` so they can be edited from the
 * dashboard and executed safely (no arbitrary code from the database). For
 * anything more advanced, code journeys live in apps/worker/journeys/*.ts and are
 * referenced by `checks.script`.
 */

export const STEP_ACTIONS = [
  "goto",
  "click",
  "fill",
  "press",
  "select",
  "check",
  "waitForSelector",
  "expectVisible",
  "expectText",
  "expectUrl",
  "wait",
] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

export interface JourneyStep {
  name: string;
  action: StepAction;
  selector?: string;
  value?: string;
  url?: string;
  timeoutMs?: number;
}

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

const NEEDS_SELECTOR: StepAction[] = ["click", "fill", "press", "select", "check", "waitForSelector", "expectVisible", "expectText"];
const NEEDS_VALUE: StepAction[] = ["fill", "press", "select", "expectText", "wait"];

export function validateJourney(input: unknown): ValidationResult<JourneyStep[]> {
  const errors: string[] = [];
  if (!Array.isArray(input)) return { ok: false, errors: ["Journey must be an array of steps"] };
  if (input.length === 0) errors.push("Journey needs at least one step");
  if (input.length > 50) errors.push("Journey is limited to 50 steps");
  const steps: JourneyStep[] = [];
  input.forEach((raw, i) => {
    const at = `Step ${i + 1}`;
    if (typeof raw !== "object" || raw === null) {
      errors.push(`${at}: must be an object`);
      return;
    }
    const s = raw as Record<string, unknown>;
    const action = s.action as StepAction;
    if (!STEP_ACTIONS.includes(action)) {
      errors.push(`${at}: unknown action "${String(s.action)}"`);
      return;
    }
    if (NEEDS_SELECTOR.includes(action) && (typeof s.selector !== "string" || !s.selector.trim()))
      errors.push(`${at}: "${action}" needs a selector`);
    if (NEEDS_VALUE.includes(action) && typeof s.value !== "string")
      errors.push(`${at}: "${action}" needs a value`);
    if ((action === "goto" || action === "expectUrl") && (typeof s.url !== "string" || !s.url))
      errors.push(`${at}: "${action}" needs a url`);
    if (s.timeoutMs !== undefined && (typeof s.timeoutMs !== "number" || s.timeoutMs < 100 || s.timeoutMs > 120_000))
      errors.push(`${at}: timeoutMs must be between 100 and 120000`);
    steps.push({
      name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : defaultStepName(action, s),
      action,
      selector: s.selector as string | undefined,
      value: s.value as string | undefined,
      url: s.url as string | undefined,
      timeoutMs: s.timeoutMs as number | undefined,
    });
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: steps, errors };
}

function defaultStepName(action: StepAction, s: Record<string, unknown>): string {
  switch (action) {
    case "goto":
      return `Open ${s.url}`;
    case "fill":
      return `Fill ${s.selector}`;
    case "click":
      return `Click ${s.selector}`;
    case "expectText":
      return `See "${s.value}"`;
    default:
      return action;
  }
}

/** Resolve a step URL against the check's base URL ("/login" -> "https://site/login"). */
export function resolveUrl(base: string | null | undefined, url: string): string {
  try {
    return new URL(url, base ?? undefined).toString();
  } catch {
    return url;
  }
}
