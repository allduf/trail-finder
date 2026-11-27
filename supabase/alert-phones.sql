-- Crash and error alerts to alex's own phone (alex 2026-11-27): run once in the Supabase SQL Editor (paste, then Run).
-- A phone gets them when it has Trail Finder notifications on and is signed in with an account listed in tf_admins
-- (supabase/usage.sql): the app then adds its push id here (notify.js), and only the server checks who is an admin.
-- The alert job (.github/workflows/app-alert.yml, secret key) reads this list and keeps the last event it checked.
-- Nobody can read either table with the public key. Safe to run again. Run supabase/push.sql first.

create table if not exists public.tf_alert_phones (
  push_id uuid primary key references public.push_subs (id) on delete cascade,
  added_at timestamptz not null default now()
);
create table if not exists public.tf_alert_state (
  id int primary key default 1 check (id = 1),
  last_id bigint not null
);
alter table public.tf_alert_phones enable row level security;   -- no policies: closed to everyone
alter table public.tf_alert_state enable row level security;

create or replace function public.tf_alert_phone_set(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from push_subs where id = p_id) then return false; end if;
  insert into tf_alert_phones (push_id) values (p_id) on conflict do nothing;
  return true;
end $$;
revoke all on function public.tf_alert_phone_set(uuid) from public;
grant execute on function public.tf_alert_phone_set(uuid) to authenticated;
