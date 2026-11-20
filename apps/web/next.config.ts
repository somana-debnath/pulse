import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Single source of truth for env: the repo-root .env.local.
// Only NEXT_PUBLIC_* values (URL + publishable key) are ever exposed to the browser.
const rootEnv = resolve(process.cwd(), "../../.env.local");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  transpilePackages: ["@pulse/core"],
  turbopack: { root: resolve(process.cwd(), "../..") },
  images: { remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }] },
  poweredByHeader: false,
};

export default config;
