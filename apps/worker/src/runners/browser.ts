import { chromium, type Browser, type Page } from "playwright";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveUrl, validateJourney, withTimeout, type CheckRow, type JourneyStep, type RunResult, type StepResult } from "@pulse/core";
import { USER_AGENT } from "./http";

export type StepFn = <T>(name: string, fn: () => Promise<T>, opts?: { timeoutMs?: number }) => Promise<T>;

/** Signature for code journeys in apps/worker/journeys/<name>.ts */
export type CodeJourney = (ctx: { page: Page; step: StepFn; baseUrl: string | null; env: NodeJS.ProcessEnv }) => Promise<void>;

export class StepFailure extends Error {}

/** Replace {{env.NAME}} placeholders so journey secrets live in env / GitHub secrets, never in the DB. */
export function interpolate(value: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  if (value === undefined) return value;
  return value.replace(/\{\{\s*env\.([A-Z0-9_]+)\s*\}\}/g, (_, name: string) => {
    const v = env[name];
    if (v === undefined) throw new Error(`Missing environment variable ${name} used by journey`);
    return v;
  });
}

async function executeStep(page: Page, step: JourneyStep, baseUrl: string | null, timeout: number, env: NodeJS.ProcessEnv): Promise<void> {
  const value = interpolate(step.value, env);
  const sel = step.selector!;
  switch (step.action) {
    case "goto": {
      const res = await page.goto(resolveUrl(baseUrl, step.url!), { timeout, waitUntil: "domcontentloaded" });
      if (res && res.status() >= 400) throw new StepFailure(`Page returned HTTP ${res.status()}`);
      return;
    }
    case "click":
      return page.locator(sel).first().click({ timeout });
    case "fill":
      return page.locator(sel).first().fill(value!, { timeout });
    case "press":
      return page.locator(sel).first().press(value!, { timeout });
    case "select":
      await page.locator(sel).first().selectOption(value!, { timeout });
      return;
    case "check":
      return page.locator(sel).first().check({ timeout });
    case "waitForSelector":
    case "expectVisible":
      return page.locator(sel).first().waitFor({ state: "visible", timeout });
    case "expectText":
      return page.locator(sel).filter({ hasText: value! }).first().waitFor({ state: "visible", timeout });
    case "expectUrl": {
      const target = step.url!;
      await page.waitForURL((u) => u.toString().includes(target), { timeout });
      return;
    }
    case "wait":
      await page.waitForTimeout(Math.min(Number(value) || 0, timeout));
      return;
  }
}

function cleanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Playwright errors include a long call log; keep the first meaningful line.
  return msg.split("\n").find((l) => l.trim())?.replace(/^\w*Error:\s*/, "").slice(0, 500) ?? "Step failed";
}

export interface BrowserRunOptions {
  browser?: Browser;
  env?: NodeJS.ProcessEnv;
  journeysDir?: string;
}

/** Single-attempt browser journey. Each step is timed; the first failing step gets a screenshot. */
export async function runBrowserCheck(
  check: Pick<CheckRow, "url" | "steps" | "script" | "timeout_ms">,
  opts: BrowserRunOptions = {},
): Promise<RunResult> {
  const env = opts.env ?? process.env;
  const ownBrowser = !opts.browser;
  const browser = opts.browser ?? (await chromium.launch({ headless: true }));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: USER_AGENT });
  const page = await context.newPage();
  const startedAt = new Date();
  const t0 = performance.now();
  const steps: StepResult[] = [];
  let error: string | null = null;

  const step: StepFn = async (name, fn, stepOpts) => {
    const timeout = stepOpts?.timeoutMs ?? check.timeout_ms;
    page.setDefaultTimeout(timeout);
    const s0 = performance.now();
    try {
      // Hard cap in addition to Playwright's own timeouts (covers hung evaluate() etc.)
      const out = await withTimeout(() => fn(), timeout + 1000, `Step "${name}"`);
      steps.push({ index: steps.length, name, ok: true, durationMs: Math.round(performance.now() - s0) });
      return out;
    } catch (err) {
      const message = cleanError(err);
      let screenshot: Uint8Array | null = null;
      try {
        screenshot = new Uint8Array(await page.screenshot({ type: "png", timeout: 5000 }));
      } catch {
        /* page may be gone */
      }
      steps.push({ index: steps.length, name, ok: false, durationMs: Math.round(performance.now() - s0), error: message, screenshot });
      throw new StepFailure(`${name}: ${message}`);
    }
  };

  try {
    if (check.script) {
      const dir = opts.journeysDir ?? resolve(import.meta.dirname, "../../journeys");
      const file = resolve(dir, `${check.script.replace(/[^a-z0-9-_]/gi, "")}.ts`);
      if (!existsSync(file)) throw new Error(`Code journey not found: ${check.script}`);
      const mod = (await import(pathToFileURL(file).href)) as { default: CodeJourney };
      await mod.default({ page, step, baseUrl: check.url, env });
    } else {
      const parsed = validateJourney(check.steps);
      if (!parsed.ok) throw new Error(`Invalid journey: ${parsed.errors.join("; ")}`);
      for (const s of parsed.value!) {
        await step(s.name, () => executeStep(page, s, check.url, s.timeoutMs ?? check.timeout_ms, env), { timeoutMs: s.timeoutMs });
      }
    }
  } catch (err) {
    error = err instanceof StepFailure ? err.message : cleanError(err);
  } finally {
    await context.close().catch(() => undefined);
    if (ownBrowser) await browser.close().catch(() => undefined);
  }

  return {
    ok: error === null,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - t0),
    statusCode: null,
    error,
    attempts: 1,
    steps,
  };
}
