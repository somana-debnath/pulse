-- Uptime & latency, computed in SQL.
--
-- Uptime is time-based:  uptime = 1 - downtime / monitored_time
--   * downtime  = union of incident intervals (open incidents run to p_now), merged with
--                 range_agg so overlapping incidents are never double-counted, then
--                 intersected with the window.
--   * monitored = window clipped to [first run, p_now], so new checks aren't penalised.
-- Latency percentiles use percentile_cont (linear interpolation) over passing runs.
-- packages/core/src/uptime.ts implements the same definitions; supabase/tests asserts they agree.

create or replace function public.check_window_uptime(
  p_check_id uuid, p_from timestamptz, p_to timestamptz, p_now timestamptz default now()
) returns numeric language sql stable set search_path = public as $$
  with since as (select min(r.started_at) as s from runs r where r.check_id = p_check_id),
  win as (
    select greatest(p_from, since.s) as ws, least(p_to, p_now) as we, since.s from since
  ),
  down as (
    select range_agg(tstzrange(i.started_at, coalesce(i.resolved_at, p_now), '[)')) as m
    from incidents i where i.check_id = p_check_id and i.started_at < p_now
  )
  select case
    when win.s is null or win.we <= win.ws then null
    else round(100 * (1 - coalesce((
      select sum(extract(epoch from upper(x) - lower(x)))
      from unnest(down.m * tstzmultirange(tstzrange(win.ws, win.we, '[)'))) x
    ), 0) / extract(epoch from win.we - win.ws)), 3)
  end
  from win, down;
$$;

create or replace function public.check_daily_uptime(
  p_check_id uuid, p_days int default 90, p_now timestamptz default now()
) returns table (day date, uptime numeric, downtime_seconds numeric)
language sql stable set search_path = public as $$
  with since as (select min(r.started_at) as s from runs r where r.check_id = p_check_id),
  down as (
    select range_agg(tstzrange(i.started_at, coalesce(i.resolved_at, p_now), '[)')) as m
    from incidents i where i.check_id = p_check_id and i.started_at < p_now
  ),
  days as (
    select d as ds
    from generate_series(
      date_trunc('day', p_now, 'UTC') - make_interval(days => p_days - 1),
      date_trunc('day', p_now, 'UTC'),
      interval '1 day'
    ) d
  ),
  win as (
    select days.ds, greatest(days.ds, since.s) as ws, least(days.ds + interval '1 day', p_now) as we, since.s
    from days, since
  ),
  calc as (
    select win.*,
      coalesce((
        select sum(extract(epoch from upper(x) - lower(x)))
        from down, unnest(down.m * tstzmultirange(tstzrange(win.ws, win.we, '[)'))) x
      ), 0) as dt
    from win
  )
  select
    (calc.ds at time zone 'UTC')::date as day,
    case when calc.s is null or calc.we <= calc.ws then null
         else round(100 * (1 - calc.dt / extract(epoch from calc.we - calc.ws)), 3) end as uptime,
    case when calc.s is null or calc.we <= calc.ws then 0 else round(calc.dt, 3) end as downtime_seconds
  from calc
  order by calc.ds;
$$;

create or replace function public.check_latency(
  p_check_id uuid, p_since timestamptz default now() - interval '24 hours'
) returns table (p50 numeric, p95 numeric, avg_ms numeric, samples bigint)
language sql stable set search_path = public as $$
  select
    round(percentile_cont(0.5)  within group (order by r.duration_ms)::numeric, 1),
    round(percentile_cont(0.95) within group (order by r.duration_ms)::numeric, 1),
    round(avg(r.duration_ms)::numeric, 1),
    count(*)
  from runs r
  where r.check_id = p_check_id and r.ok and r.started_at >= p_since;
$$;

-- Hourly (or custom) buckets for response-time charts.
create or replace function public.check_response_series(
  p_check_id uuid, p_since timestamptz default now() - interval '24 hours', p_bucket interval default interval '1 hour'
) returns table (bucket timestamptz, p50 numeric, p95 numeric, samples bigint)
language sql stable set search_path = public as $$
  select
    date_bin(p_bucket, r.started_at, timestamptz '2000-01-01 00:00:00+00') as bucket,
    round(percentile_cont(0.5)  within group (order by r.duration_ms)::numeric, 1),
    round(percentile_cont(0.95) within group (order by r.duration_ms)::numeric, 1),
    count(*)
  from runs r
  where r.check_id = p_check_id and r.ok and r.started_at >= p_since
  group by 1 order by 1;
$$;

-- Dashboard: one row per check the caller owns (security invoker => RLS applies).
create or replace function public.dashboard_checks(p_now timestamptz default now())
returns table (
  id uuid, project_id uuid, project_name text, project_slug text, name text, type public.check_type,
  url text, state public.check_state, enabled boolean, interval_minutes int, last_run_at timestamptz,
  uptime_30d numeric, uptime_90d numeric, p50_24h numeric, p95_24h numeric, daily jsonb
) language sql stable security invoker set search_path = public as $$
  select c.id, c.project_id, p.name, p.slug, c.name, c.type, c.url, c.state, c.enabled, c.interval_minutes, c.last_run_at,
    check_window_uptime(c.id, p_now - interval '30 days', p_now, p_now),
    check_window_uptime(c.id, p_now - interval '90 days', p_now, p_now),
    l.p50, l.p95,
    (select jsonb_agg(jsonb_build_object('day', d.day, 'uptime', d.uptime) order by d.day)
       from check_daily_uptime(c.id, 90, p_now) d)
  from checks c
  join projects p on p.id = c.project_id
  left join lateral check_latency(c.id, p_now - interval '24 hours') l on true
  order by p.name, c.name;
$$;

-- Public status page. Security definer, but only ever returns public projects and
-- only presentation-safe fields (no URLs, journey steps, raw errors or screenshots).
create or replace function public.status_page(p_slug text, p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path = public as $$
  with proj as (select * from projects where slug = p_slug and is_public)
  select case when not exists (select 1 from proj) then null else jsonb_build_object(
    'project', (select jsonb_build_object('name', name, 'slug', slug, 'description', description, 'website_url', website_url) from proj),
    'generated_at', p_now,
    'checks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'type', c.type,
        'state', case when c.enabled then c.state::text else 'paused' end,
        'uptime_90d', check_window_uptime(c.id, p_now - interval '90 days', p_now, p_now),
        'daily', (select jsonb_agg(jsonb_build_object('day', d.day, 'uptime', d.uptime, 'downtime_seconds', d.downtime_seconds) order by d.day)
                    from check_daily_uptime(c.id, 90, p_now) d),
        'latency', (select to_jsonb(l) from check_latency(c.id, p_now - interval '24 hours') l),
        'series', (select coalesce(jsonb_agg(jsonb_build_object('t', s.bucket, 'p50', s.p50, 'p95', s.p95) order by s.bucket), '[]'::jsonb)
                     from check_response_series(c.id, p_now - interval '24 hours', interval '1 hour') s)
      ) order by c.name)
      from checks c where c.project_id = (select id from proj)
    ), '[]'::jsonb),
    'incidents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'check_name', c.name, 'started_at', i.started_at, 'resolved_at', i.resolved_at,
        'duration_seconds', coalesce(i.duration_seconds, extract(epoch from p_now - i.started_at)),
        'failing_step', i.failing_step
      ) order by i.started_at desc)
      from incidents i join checks c on c.id = i.check_id
      where c.project_id = (select id from proj) and i.started_at >= p_now - interval '90 days'
    ), '[]'::jsonb)
  ) end;
$$;

revoke execute on function public.status_page(text, timestamptz) from public;
grant execute on function public.status_page(text, timestamptz) to anon, authenticated;
grant execute on function public.dashboard_checks(timestamptz) to authenticated;
grant execute on function public.check_latency(uuid, timestamptz) to authenticated;
grant execute on function public.check_response_series(uuid, timestamptz, interval) to authenticated;
grant execute on function public.check_daily_uptime(uuid, int, timestamptz) to authenticated;
grant execute on function public.check_window_uptime(uuid, timestamptz, timestamptz, timestamptz) to authenticated;
