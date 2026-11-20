/**
 * Apply supabase/migrations/*.sql in order to DATABASE_URL (from .env.local).
 * Every migration is idempotent, so re-running is safe. Each file runs in its own transaction.
 *   npm run db:migrate            # all migrations
 *   npm run db:migrate -- --seed  # also run supabase/seed.sql
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (add it to .env.local)");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
} catch (err) {
  console.error(`Could not connect: ${(err as Error).message}`);
  process.exit(2);
}
const { rows: [v] } = await client.query("select current_setting('server_version') as v");
console.log(`Connected (Postgres ${v.v})`);

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
if (process.argv.includes("--seed")) files.push("../seed.sql");

for (const f of files) {
  const sql = readFileSync(join(dir, f), "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    console.log(`✓ ${f}`);
  } catch (err) {
    await client.query("rollback").catch(() => {});
    console.error(`✗ ${f}: ${(err as Error).message}`);
    await client.end();
    process.exit(1);
  }
}
await client.end();
console.log("Migrations applied.");
