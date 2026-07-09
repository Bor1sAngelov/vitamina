-- =========================================================
-- ВИТАМИНА — Supabase schema
--
-- Run this once in the Supabase Dashboard → SQL Editor (project
-- linked from SUPABASE_URL / SUPABASE_ANON_KEY in js/data.js).
-- Every statement is idempotent (IF NOT EXISTS / OR REPLACE / a
-- DROP POLICY IF EXISTS before each CREATE POLICY), so it is safe
-- to re-run the whole file after future edits.
--
-- ---------------------------------------------------------------
-- ⚠️ ONE-TIME SETUP REQUIRED for the admin login (admin.html) to work:
-- 1. Supabase Dashboard → Authentication → Users → "Add user".
-- 2. Email: must match ADMIN_EMAIL in js/script.js exactly
--    (currently "admin@vitamina-vratsa.bg" — change both together
--    if you'd rather use a different address).
-- 3. Password: whatever the team should type into the admin login
--    screen — this REPLACES the old hardcoded "vitamina2026".
-- 4. Tick "Auto Confirm User" so no confirmation email is required.
-- Without this user, admin.html cannot log in at all (see RLS below —
-- reading/editing orders & applications now requires a real signed-in
-- Supabase user, not just the public anon key).
-- ---------------------------------------------------------------
--
-- Tables:
--   orders       — customer orders placed from cart.html (js/script.js: createOrder / mirrorOrderUpdate / mirrorOrderDelete)
--   applications — job applications submitted from jobs.html (js/script.js: createApplication / mirrorApplicationUpdate/Delete)
--   settings     — small key/value store: "orderingPaused" flag (admin.html) and "soupSchedule" (weekly soup rotation + tarator, admin.html)
--   page_views   — one row per page load, used by viewer.html to show per-page visit counts
--
-- All customer-facing writes (placing an order, submitting a job
-- application) stay open to the "anon" role, since customers never log
-- in. Reading/editing/deleting that data now requires a real signed-in
-- Supabase user (see ADMIN_EMAIL in js/script.js + Supabase Auth) —
-- SUPABASE_ANON_KEY alone is no longer enough to read or wipe orders/
-- applications. "settings" stays anon-readable (customer pages need it
-- to show today's soup / whether ordering is paused, without logging
-- in) but only a signed-in admin can change it. "page_views" is left
-- as anon read/write — it holds no personal data, just page + a random
-- per-browser id — and viewer.html keeps its lightweight password gate.
-- =========================================================

-- ---------------------------------------------------------
-- orders
-- ---------------------------------------------------------
create table if not exists public.orders (
  id              text primary key,              -- client-generated, e.g. "ord_1720000000000"
  number          integer not null,               -- sequential, human-facing order number
  date            timestamptz not null default now(),
  name            text not null,
  phone           text not null,
  time            text default '',                -- requested pickup time, e.g. "14:30", or ""
  note            text default '',
  items           jsonb not null default '[]'::jsonb,   -- [{ name, details, qty, price, note, minNote }]
  total           numeric not null default 0,
  status          text not null default 'new',    -- 'new' | 'done'
  "confirmStatus" text not null default 'pending',-- 'pending' | 'confirmed' | 'delayed'
  "delayMinutes"  integer                          -- set when confirmStatus = 'delayed'
);

alter table public.orders enable row level security;

drop policy if exists "orders_select_anon" on public.orders;
drop policy if exists "orders_select_auth" on public.orders;
create policy "orders_select_anon" on public.orders
  for select to anon, authenticated using (true);

drop policy if exists "orders_insert_anon" on public.orders;
create policy "orders_insert_anon" on public.orders
  for insert to anon, authenticated with check (true);

drop policy if exists "orders_update_anon" on public.orders;
drop policy if exists "orders_update_auth" on public.orders;
create policy "orders_update_auth" on public.orders
  for update to authenticated using (true) with check (true);

drop policy if exists "orders_delete_anon" on public.orders;
drop policy if exists "orders_delete_auth" on public.orders;
create policy "orders_delete_auth" on public.orders
  for delete to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;


-- ---------------------------------------------------------
-- applications  (job applications submitted from jobs.html)
-- ---------------------------------------------------------
create table if not exists public.applications (
  id          text primary key,              -- client-generated, e.g. "app_1720000000000"
  date        timestamptz not null default now(),
  name        text not null,
  phone       text not null,
  email       text default '',
  position    text default '',
  experience  text default '',
  message     text default '',
  "photoName" text default '',
  "photoData" text default '',               -- base64 data URL (may be a few MB — see field-hint on jobs.html)
  "cvName"    text default '',
  "cvData"    text default '',               -- base64 data URL
  status      text not null default 'new'    -- 'new' | 'done'
);

alter table public.applications enable row level security;

drop policy if exists "applications_select_anon" on public.applications;
drop policy if exists "applications_select_auth" on public.applications;
create policy "applications_select_anon" on public.applications
  for select to anon, authenticated using (true);

drop policy if exists "applications_insert_anon" on public.applications;
create policy "applications_insert_anon" on public.applications
  for insert to anon, authenticated with check (true);

drop policy if exists "applications_update_anon" on public.applications;
drop policy if exists "applications_update_auth" on public.applications;
create policy "applications_update_auth" on public.applications
  for update to authenticated using (true) with check (true);

drop policy if exists "applications_delete_anon" on public.applications;
drop policy if exists "applications_delete_auth" on public.applications;
create policy "applications_delete_auth" on public.applications
  for delete to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'applications'
  ) then
    alter publication supabase_realtime add table public.applications;
  end if;
end $$;


-- ---------------------------------------------------------
-- settings  (key/value; "orderingPaused" -> { paused: bool }, "soupSchedule" -> { "0":[...], "1":[...], ... })
-- ---------------------------------------------------------
create table if not exists public.settings (
  key   text primary key,
  value jsonb not null default '{}'::jsonb
);

alter table public.settings enable row level security;

drop policy if exists "settings_select_anon" on public.settings;
create policy "settings_select_anon" on public.settings
  for select to anon, authenticated using (true);

drop policy if exists "settings_insert_anon" on public.settings;
drop policy if exists "settings_insert_auth" on public.settings;
create policy "settings_insert_auth" on public.settings
  for insert to authenticated with check (true);

drop policy if exists "settings_update_anon" on public.settings;
drop policy if exists "settings_update_auth" on public.settings;
create policy "settings_update_auth" on public.settings
  for update to authenticated using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'settings'
  ) then
    alter publication supabase_realtime add table public.settings;
  end if;
end $$;


-- ---------------------------------------------------------
-- page_views  (one row per page load; powers viewer.html)
-- ---------------------------------------------------------
create table if not exists public.page_views (
  id         bigint generated always as identity primary key,
  page       text not null,                 -- page slug: 'index' | 'menu' | 'cart' | 'jobs' | 'contact'
  visitor_id text not null,                  -- random id kept in localStorage, identifies a browser, not a person
  viewed_at  timestamptz not null default now()
);

create index if not exists page_views_page_idx on public.page_views (page);

alter table public.page_views enable row level security;

drop policy if exists "page_views_insert_anon" on public.page_views;
create policy "page_views_insert_anon" on public.page_views
  for insert to anon with check (true);

drop policy if exists "page_views_select_anon" on public.page_views;
create policy "page_views_select_anon" on public.page_views
  for select to anon using (true);

-- Aggregated per-page counts — viewer.html reads this view instead of
-- pulling every raw row, so it stays cheap as page_views grows.
create or replace view public.page_view_stats
  with (security_invoker = true) as
select
  page,
  count(*)                   as total_views,
  count(distinct visitor_id) as unique_views,
  max(viewed_at)             as last_viewed_at
from public.page_views
group by page
order by page;

grant select on public.page_view_stats to anon;
