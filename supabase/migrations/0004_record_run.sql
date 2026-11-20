-- Atomic, idempotent run recording.
--
-- The worker computes the next incident state in TypeScript (packages/core/src/incident.ts)
-- and calls record_run() once per run. In a single transaction it:
--   1. inserts the run keyed by idempotency_key; a duplicate (retried job) returns early
--      and changes nothing — no counters, no incidents, no alerts;
--   2. applies the new counters with an optimistic check on state_version; if another
--      worker moved the state first, it raises 'state_conflict' and the whole transaction
--      (including the run insert) rolls back so the worker can re-read and retry;
--   3. opens or resolves the incident. Incident start = first failure of the streak,
--      end = first pass of the recovery streak, so durations reflect real outage time.

create or replace function public.record_run(
  p_check_id          uuid,
  p_idempotency_key   text,
  p_slot              timestamptz,
  p_run               jsonb,     -- {started_at, finished_at, ok, duration_ms, status_code, error, attempts, region}
  p_steps             jsonb,     -- [{idx, name, ok, duration_ms, error, screenshot_url}]
  p_expected_version  int,
  p_next_state        public.check_state,
  p_next_failures     int,
  p_next_successes    int,
  p_transition        text,      -- 'opened' | 'resolved' | null
  p_failing_step      text default null,
  p_error             text default null,
  p_screenshot_url    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run_id      uuid;
  v_started     timestamptz := (p_run ->> 'started_at')::timestamptz;
  v_incident_id uuid;
  v_since       timestamptz;
begin
  insert into runs (check_id, idempotency_key, slot, started_at, finished_at, ok, duration_ms, status_code, error, attempts, region)
  values (
    p_check_id, p_idempotency_key, p_slot, v_started, (p_run ->> 'finished_at')::timestamptz,
    (p_run ->> 'ok')::boolean, (p_run ->> 'duration_ms')::int, nullif(p_run ->> 'status_code', '')::int,
    p_run ->> 'error', coalesce((p_run ->> 'attempts')::int, 1), p_run ->> 'region'
  )
  on conflict (idempotency_key) do nothing
  returning id into v_run_id;

  if v_run_id is null then
    select id into v_run_id from runs where idempotency_key = p_idempotency_key;
    return jsonb_build_object('duplicate', true, 'run_id', v_run_id, 'transition', null);
  end if;

  insert into run_steps (run_id, idx, name, ok, duration_ms, error, screenshot_url)
  select v_run_id, (s ->> 'idx')::int, s ->> 'name', (s ->> 'ok')::boolean, (s ->> 'duration_ms')::int, s ->> 'error', s ->> 'screenshot_url'
  from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) s;

  update checks set
    state = p_next_state,
    consecutive_failures = p_next_failures,
    consecutive_successes = p_next_successes,
    state_version = state_version + 1,
    last_slot = greatest(coalesce(last_slot, p_slot), p_slot),
    last_run_at = greatest(coalesce(last_run_at, v_started), v_started)
  where id = p_check_id and state_version = p_expected_version;

  if not found then
    raise exception 'state_conflict' using errcode = '40001',
      detail = format('check %s is no longer at state_version %s', p_check_id, p_expected_version);
  end if;

  if p_transition = 'opened' then
    -- the outage began at the first failure after the most recent pass
    select min(r.started_at) into v_since from runs r
    where r.check_id = p_check_id and not r.ok
      and r.started_at > coalesce((select max(started_at) from runs where check_id = p_check_id and ok), '-infinity');

    insert into incidents (check_id, started_at, opened_run_id, failing_step, error, screenshot_url)
    values (p_check_id, coalesce(v_since, v_started), v_run_id, p_failing_step, p_error, p_screenshot_url)
    on conflict (check_id) where resolved_at is null do nothing
    returning id into v_incident_id;

  elsif p_transition = 'resolved' then
    -- service was restored at the first pass after the most recent failure
    select min(r.started_at) into v_since from runs r
    where r.check_id = p_check_id and r.ok
      and r.started_at > coalesce((select max(started_at) from runs where check_id = p_check_id and not ok), '-infinity');

    update incidents i set resolved_at = greatest(i.started_at, coalesce(v_since, v_started)), resolved_run_id = v_run_id
    where i.check_id = p_check_id and i.resolved_at is null
    returning i.id into v_incident_id;
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'run_id', v_run_id,
    'transition', case when v_incident_id is null then null else p_transition end,
    'incident_id', v_incident_id
  );
end;
$$;

-- Alert claims: first caller wins; failed (or stuck >10 min) claims can be re-taken.
create or replace function public.claim_alert(p_key text, p_incident_id uuid, p_kind text, p_channel text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  insert into alerts (dedup_key, incident_id, kind, channel)
  values (p_key, p_incident_id, p_kind, p_channel)
  on conflict (dedup_key) do update
    set status = 'pending', attempts = alerts.attempts + 1, updated_at = now()
    where alerts.status = 'failed'
       or (alerts.status = 'pending' and alerts.updated_at < now() - interval '10 minutes')
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

create or replace function public.finish_alert(p_key text, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update alerts set
    status = case when p_ok then 'sent' else 'failed' end,
    sent_at = case when p_ok then now() else sent_at end,
    last_error = p_error,
    updated_at = now()
  where dedup_key = p_key;
$$;

revoke execute on function public.record_run(uuid, text, timestamptz, jsonb, jsonb, int, public.check_state, int, int, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.claim_alert(text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.finish_alert(text, boolean, text) from public, anon, authenticated;
grant execute on function public.record_run(uuid, text, timestamptz, jsonb, jsonb, int, public.check_state, int, int, text, text, text, text) to service_role;
grant execute on function public.claim_alert(text, uuid, text, text) to service_role;
grant execute on function public.finish_alert(text, boolean, text) to service_role;
