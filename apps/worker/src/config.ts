import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Load the repo-root .env.local (if present) without overriding real env vars. */
export function loadEnv(): void {
  for (const candidate of [resolve(process.cwd(), ".env.local"), resolve(process.cwd(), "../../.env.local")]) {
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        /* ignore malformed file */
      }
      return;
    }
  }
}

export interface WorkerConfig {
  supabaseUrl?: string;
  supabaseSecretKey?: string;
  discordWebhookUrl?: string;
  smtpUrl?: string;
  emailFrom?: string;
  emailTo?: string;
  publicAppUrl: string;
  region: string;
  concurrency: number;
  artifactsDir?: string;
  retryBaseDelayMs: number;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    supabaseUrl: env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseSecretKey: env.SUPABASE_SECRET_KEY,
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL || undefined,
    smtpUrl: env.SMTP_URL || undefined,
    emailFrom: env.ALERT_EMAIL_FROM || undefined,
    emailTo: env.ALERT_EMAIL_TO || undefined,
    publicAppUrl: (env.PUBLIC_APP_URL || "http://localhost:3011").replace(/\/$/, ""),
    region: env.PULSE_REGION || (env.GITHUB_ACTIONS ? "github-actions" : "local"),
    concurrency: Number(env.PULSE_CONCURRENCY ?? 4),
    artifactsDir: env.PULSE_ARTIFACTS_DIR || (env.GITHUB_ACTIONS ? "artifacts" : undefined),
    retryBaseDelayMs: Number(env.PULSE_RETRY_BASE_MS ?? 2000),
  };
}
