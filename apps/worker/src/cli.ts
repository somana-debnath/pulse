/**
 * pulse worker
 *
 *   tsx src/cli.ts            long-running scheduler (Docker): ticks every minute
 *   tsx src/cli.ts --once     a single tick, then exit (GitHub Actions cron)
 *   --dry-run                 use an in-memory store with a demo check against the local test site
 *   --force                   run every enabled check, even if already run this slot
 */
import { chromium, type Browser } from "playwright";
import type { Notifier } from "@pulse/core";
import { loadEnv, readConfig } from "./config";
import { tick } from "./engine";
import { runCheck } from "./runners";
import { MemoryStore } from "./store/memory";
import { SupabaseStore } from "./store/supabase";
import type { Store } from "./store/types";
import { discordNotifier } from "./notifiers/discord";
import { emailNotifier } from "./notifiers/email";

loadEnv();
const cfg = readConfig();
const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const dryRun = args.has("--dry-run");
const log = (m: string) => console.log(m);

function buildStore(): Store {
  if (!dryRun && cfg.supabaseUrl && cfg.supabaseSecretKey) return new SupabaseStore(cfg.supabaseUrl, cfg.supabaseSecretKey);
  if (!dryRun) log("SUPABASE_SECRET_KEY not set — running against an in-memory demo store (use --dry-run to silence this).");
  const site = process.env.TEST_SITE_URL ?? "http://localhost:3012";
  const base = {
    project_id: "demo",
    method: "GET",
    expected_status: 200,
    max_response_ms: 2000,
    steps: null,
    script: null,
    interval_minutes: 1,
    timeout_ms: 10_000,
    retries: 1,
    enabled: true,
    state: "unknown" as const,
    consecutive_failures: 0,
    consecutive_successes: 0,
    state_version: 0,
    last_slot: null,
    last_run_at: null,
    created_at: new Date().toISOString(),
    project: { id: "demo", name: "Acme Shop", slug: "demo" },
  };
  return new MemoryStore([
    { ...base, id: "demo-http", name: "Health endpoint", type: "http", url: `${site}/health` },
    { ...base, id: "demo-journey", name: "Search and add to cart", type: "browser", url: site, script: "acme-checkout" },
  ]);
}

function buildNotifiers(): Notifier[] {
  const n: Notifier[] = [];
  if (cfg.discordWebhookUrl) n.push(discordNotifier(cfg.discordWebhookUrl));
  if (cfg.smtpUrl && cfg.emailFrom && cfg.emailTo) n.push(emailNotifier(cfg.smtpUrl, cfg.emailFrom, cfg.emailTo));
  if (!n.length) log("No alert channels configured (DISCORD_WEBHOOK_URL / SMTP_URL). Incidents will be recorded but not sent.");
  return n;
}

const store = buildStore();
const notifiers = buildNotifiers();
let browser: Browser | undefined;

async function getBrowser() {
  if (!browser || !browser.isConnected()) browser = await chromium.launch({ headless: true });
  return browser;
}

async function runTick() {
  const b = await getBrowser();
  const outcomes = await tick({
    store,
    notifiers,
    run: (c) => runCheck(c, { browser: c.type === "browser" ? b : undefined, retryBaseDelayMs: cfg.retryBaseDelayMs, log }),
    region: cfg.region,
    publicAppUrl: cfg.publicAppUrl,
    artifactsDir: cfg.artifactsDir,
    concurrency: cfg.concurrency,
    force: args.has("--force"),
    log,
  });
  return outcomes;
}

if (once) {
  const outcomes = await runTick();
  await browser?.close();
  const failed = outcomes.filter((o) => !o.result.ok).length;
  log(`Done: ${outcomes.length} run(s), ${failed} failing.`);
  // Exit 0 even when checks fail: a failing *site* is data, not a broken job.
  process.exit(0);
} else {
  log("Pulse worker started — ticking every 60s. Ctrl+C to stop.");
  let running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    try {
      await runTick();
    } catch (err) {
      log(`tick failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };
  await loop();
  const timer = setInterval(loop, 60_000);
  const stop = async () => {
    clearInterval(timer);
    await browser?.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
