# syntax=docker/dockerfile:1.7
# Multi-target build for the Pulse monorepo: `web`, `worker`, `test-site`.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/test-site/package.json apps/test-site/
RUN npm ci --no-audit --no-fund

# ---------- web (Next.js standalone) ----------
FROM deps AS web-build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build -w @pulse/web

FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3011 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3011
CMD ["node", "apps/web/server.js"]

# ---------- worker (scheduler + Playwright) ----------
FROM mcr.microsoft.com/playwright:v1.65.1-noble AS worker
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
CMD ["npx", "tsx", "apps/worker/src/cli.ts"]

# ---------- toggleable demo site ----------
FROM deps AS test-site
COPY apps/test-site apps/test-site
EXPOSE 3012
CMD ["npx", "tsx", "apps/test-site/src/cli.ts"]
