-- Pulse schema: projects -> checks -> runs -> run_steps, plus incidents and alerts.

create extension if not exists pgcrypto;

do $$ begin
  create type public.check_type as enum ('http', 'browser');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.check_state as enum ('unknown', 'up', 'down');
exception when duplicate_object then null; end $$;

create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  slug         text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  description  text,
  website_url  text,
  is_public    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists public.checks (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects (id) on delete cascade,
  name                   text not null check (char_length(name) between 1 and 120),
  type                   public.check_type not null default 'http',
  url                    text,
  method                 text not null default 'GET' check (method in ('GET', 'HEAD', 'POST')),
  expected_status        int not null default 200 check (expected_status between 100 and 599),
  max_response_ms        int check (max_response_ms is null or max_response_ms > 0),
  steps                  jsonb,          -- declarative Playwright journey (see packages/core/src/journey.ts)
  script                 text,           -- or a code journey in apps/worker/journeys/<script>.ts
  interval_minutes       int not null default 5 check (interval_minutes between 1 and 1440),
  timeout_ms             int not null default 15000 check (timeout_ms between 500 and 120000),
  retries                int not null default 1 check (retries between 0 and 5),
  enabled                boolean not null default true,
  -- incident state machine (written only by record_run)
  state                  public.check_state not null default 'unknown',
  consecutive_failures   int not null default 0,
  consecutive_successes  int not null default 0,
  state_version          int not null default 0,
  last_slot              timestamptz,
  last_run_at            timestamptz,
  created_at             timestamptz not null default now(),
  constraint http_needs_url check (type <> 'http' or url is not null),
  constraint browser_needs_journey check (type <> 'browser' or steps is not null or script is not null)
);
create index if not exists checks_project_idx on public.checks (project_id);

create table if not exists public.runs (
  id               uuid primary key default gen_random_uuid(),
  check_id         uuid not null references public.checks (id) on delete cascade,
  idempotency_key  text not null unique,   -- "<check_id>:<slot ISO>" — one run per check per slot
  slot             timestamptz not null,
  started_at       timestamptz not null,
  finished_at      timestamptz not null,
  ok               boolean not null,
  duration_ms      int not null check (duration_ms >= 0),
  status_code      int,
  error            text,
  attempts         int not null default 1,
  region           text,
  created_at       timestamptz not null default now()
);
create index if not exists runs_check_time_idx on public.runs (check_id, started_at desc);

create table if not exists public.run_steps (
  id              bigint generated always as identity primary key,
  run_id          uuid not null references public.runs (id) on delete cascade,
  idx             int not null,
  name            text not null,
  ok              boolean not null,
  duration_ms     int not null,
  error           text,
  screenshot_url  text,
  unique (run_id, idx)
);

create table if not exists public.incidents (
  id                uuid primary key default gen_random_uuid(),
  check_id          uuid not null references public.checks (id) on delete cascade,
  started_at        timestamptz not null,
  resolved_at       timestamptz,
  duration_seconds  numeric generated always as (extract(epoch from (resolved_at - started_at))) stored,
  opened_run_id     uuid references public.runs (id) on delete set null,
  resolved_run_id   uuid references public.runs (id) on delete set null,
  failing_step      text,
  error             text,
  screenshot_url    text,
  created_at        timestamptz not null default now(),
  constraint resolved_after_start check (resolved_at is null or resolved_at >= started_at)
);
-- At most one open incident per check, enforced by the database.
create unique index if not exists incidents_one_open_per_check on public.incidents (check_id) where resolved_at is null;
create index if not exists incidents_check_time_idx on public.incidents (check_id, started_at desc);

create table if not exists public.alerts (
  dedup_key    text primary key,              -- "<incident_id>:<kind>:<channel>"
  incident_id  uuid not null references public.incidents (id) on delete cascade,
  kind         text not null check (kind in ('opened', 'resolved')),
  channel      text not null check (channel in ('discord', 'email')),
  status       text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts     int not null default 1,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  sent_at      timestamptz
);
