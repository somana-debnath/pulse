-- Example checks for your own projects.
-- 1. Sign in to the Pulse dashboard once (creates your auth user).
-- 2. Replace the placeholder URLs below (search for "REPLACE").
-- 3. Run this file in the Supabase SQL editor. It attaches the projects to the
--    oldest auth user (you), and is safe to re-run.

do $$
declare
  v_owner uuid := (select id from auth.users order by created_at limit 1);
  v_scam  uuid;
  v_jars  uuid;
  v_port  uuid;
begin
  if v_owner is null then
    raise notice 'No auth user yet: sign in to the dashboard first, then re-run seed.sql';
  end if;

  insert into public.projects (owner_id, name, slug, description, website_url, is_public)
  values
    (v_owner, 'Scam Shield', 'scam-shield', 'Real-time scam detection for messages and links.', 'https://scam-shield.example.com', true), -- REPLACE
    (v_owner, 'Jars', 'jars', 'Savings jars and shared budgets.', 'https://jars.example.com', true),                                     -- REPLACE
    (v_owner, 'Portfolio', 'portfolio', 'Personal portfolio and blog.', 'https://portfolio.example.com', true)                          -- REPLACE
  on conflict (slug) do update set owner_id = coalesce(public.projects.owner_id, excluded.owner_id);

  select id into v_scam from public.projects where slug = 'scam-shield';
  select id into v_jars from public.projects where slug = 'jars';
  select id into v_port from public.projects where slug = 'portfolio';

  if not exists (select 1 from public.checks where project_id = v_scam) then
    insert into public.checks (project_id, name, type, url, expected_status, max_response_ms, interval_minutes) values
      (v_scam, 'Homepage', 'http', 'https://scam-shield.example.com', 200, 2000, 5),
      (v_scam, 'API health', 'http', 'https://scam-shield.example.com/api/health', 200, 1000, 5);
    insert into public.checks (project_id, name, type, url, interval_minutes, timeout_ms, steps) values
      (v_scam, 'Scan a suspicious link', 'browser', 'https://scam-shield.example.com', 10, 15000, '[
        {"name": "Open home page",     "action": "goto",          "url": "/"},
        {"name": "Paste a link",       "action": "fill",          "selector": "input[name=url], textarea", "value": "https://free-gift-card.example.net"},
        {"name": "Run the scan",       "action": "click",         "selector": "button[type=submit]"},
        {"name": "See a verdict",      "action": "expectVisible", "selector": "[data-testid=verdict], .verdict", "timeoutMs": 20000}
      ]'::jsonb);
  end if;

  if not exists (select 1 from public.checks where project_id = v_jars) then
    insert into public.checks (project_id, name, type, url, expected_status, max_response_ms, interval_minutes) values
      (v_jars, 'Web app', 'http', 'https://jars.example.com', 200, 2000, 5);
    insert into public.checks (project_id, name, type, url, interval_minutes, timeout_ms, steps) values
      (v_jars, 'Log in and open a jar', 'browser', 'https://jars.example.com', 10, 15000, '[
        {"name": "Open login",         "action": "goto",          "url": "/login"},
        {"name": "Enter email",        "action": "fill",          "selector": "input[type=email]",    "value": "{{env.JARS_TEST_EMAIL}}"},
        {"name": "Enter password",     "action": "fill",          "selector": "input[type=password]", "value": "{{env.JARS_TEST_PASSWORD}}"},
        {"name": "Submit",             "action": "click",         "selector": "button[type=submit]"},
        {"name": "Dashboard loads",    "action": "expectVisible", "selector": "[data-testid=jars-list], main"}
      ]'::jsonb);
  end if;

  if not exists (select 1 from public.checks where project_id = v_port) then
    insert into public.checks (project_id, name, type, url, expected_status, max_response_ms, interval_minutes) values
      (v_port, 'Homepage', 'http', 'https://portfolio.example.com', 200, 2500, 15);
    insert into public.checks (project_id, name, type, url, interval_minutes, steps) values
      (v_port, 'Projects page renders', 'browser', 'https://portfolio.example.com', 30, '[
        {"name": "Open home",          "action": "goto",          "url": "/"},
        {"name": "Go to projects",     "action": "click",         "selector": "a[href*=project]"},
        {"name": "See a project",      "action": "expectVisible", "selector": "article, [data-testid=project]"}
      ]'::jsonb);
  end if;
end $$;
