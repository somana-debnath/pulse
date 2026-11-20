-- Row Level Security on every table.
--
-- Model:
--  * Owners (auth.uid() = projects.owner_id) can read everything in their projects
--    and create/edit/delete projects and checks.
--  * Nobody can write runs/run_steps/incidents/alerts through the API: only the
--    worker can, using the secret key (service_role bypasses RLS) via record_run().
--  * The public status page never reads tables directly. It calls the
--    security-definer function status_page(slug), which returns a curated subset
--    (no URLs, journey steps or error bodies) and only for projects marked public.

alter table public.projects  enable row level security;
alter table public.checks    enable row level security;
alter table public.runs      enable row level security;
alter table public.run_steps enable row level security;
alter table public.incidents enable row level security;
alter table public.alerts    enable row level security;

-- Stable helper so policies on child tables stay cheap and non-recursive.
create or replace function public.owns_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid());
$$;

create or replace function public.owns_check(p_check_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.checks c join public.projects p on p.id = c.project_id
    where c.id = p_check_id and p.owner_id = auth.uid()
  );
$$;

-- projects
drop policy if exists projects_owner_select on public.projects;
create policy projects_owner_select on public.projects for select to authenticated using (owner_id = auth.uid());
drop policy if exists projects_owner_insert on public.projects;
create policy projects_owner_insert on public.projects for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists projects_owner_update on public.projects;
create policy projects_owner_update on public.projects for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists projects_owner_delete on public.projects;
create policy projects_owner_delete on public.projects for delete to authenticated using (owner_id = auth.uid());

-- checks
drop policy if exists checks_owner_select on public.checks;
create policy checks_owner_select on public.checks for select to authenticated using (public.owns_project(project_id));
drop policy if exists checks_owner_insert on public.checks;
create policy checks_owner_insert on public.checks for insert to authenticated with check (public.owns_project(project_id));
drop policy if exists checks_owner_update on public.checks;
create policy checks_owner_update on public.checks for update to authenticated using (public.owns_project(project_id)) with check (public.owns_project(project_id));
drop policy if exists checks_owner_delete on public.checks;
create policy checks_owner_delete on public.checks for delete to authenticated using (public.owns_project(project_id));

-- Owners may edit configuration but never the state-machine columns.
revoke update on public.checks from authenticated;
grant update (name, type, url, method, expected_status, max_response_ms, steps, script,
              interval_minutes, timeout_ms, retries, enabled) on public.checks to authenticated;

-- runs / steps / incidents / alerts: owner read-only
drop policy if exists runs_owner_select on public.runs;
create policy runs_owner_select on public.runs for select to authenticated using (public.owns_check(check_id));

drop policy if exists run_steps_owner_select on public.run_steps;
create policy run_steps_owner_select on public.run_steps for select to authenticated
  using (exists (select 1 from public.runs r where r.id = run_id and public.owns_check(r.check_id)));

drop policy if exists incidents_owner_select on public.incidents;
create policy incidents_owner_select on public.incidents for select to authenticated using (public.owns_check(check_id));

drop policy if exists alerts_owner_select on public.alerts;
create policy alerts_owner_select on public.alerts for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id and public.owns_check(i.check_id)));

-- The anon role gets no table access at all.
revoke all on public.projects, public.checks, public.runs, public.run_steps, public.incidents, public.alerts from anon;
