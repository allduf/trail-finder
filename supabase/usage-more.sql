-- Trail Finder app usage, part 2: run once in the Supabase SQL Editor (paste, then Run), after usage.sql.
-- Lets the app send what people search for and how many results they got, which trail cards and results they open,
-- how long the page, map and 3D take to load, restarts after a crash, and the named area on the map (a zone like
-- "Whistler" or a province). Adds the full tester list for usage.html. Safe to run again.

alter table public.tf_use_events drop constraint if exists tf_use_events_kind_check;
alter table public.tf_use_events add constraint tf_use_events_kind_check
  check (kind in ('open', 'tap', 'sport', 'error', 'end', 'search', 'result', 'pick', 'view', 'speed', 'crash', 'area'));

-- The app sends a batch of events (at most 200 per call). For search and result, ms holds the number of results.
create or replace function public.tf_use(device text, os text, screen text, events jsonb) returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  insert into tf_use_devices (device, os, screen) values (tf_use.device, left(tf_use.os, 40), left(tf_use.screen, 20))
  on conflict (device) do update set os = excluded.os, screen = excluded.screen, last_seen = now();
  insert into tf_use_events (device, session, at, page, kind, what, ms)
  select tf_use.device, left(e->>'s', 40), least(coalesce((e->>'t')::timestamptz, now()), now()), left(e->>'p', 20),
         e->>'k', left(e->>'w', 120), least(greatest((e->>'ms')::int, 0), 86400000)
  from jsonb_array_elements(case when jsonb_typeof(tf_use.events) = 'array' then tf_use.events else '[]'::jsonb end)
       with ordinality as x(e, i)
  where x.i <= 200 and coalesce(e->>'s', '') <> ''
    and e->>'k' in ('open', 'tap', 'sport', 'error', 'end', 'search', 'result', 'pick', 'view', 'speed', 'crash', 'area');
end $$;

-- Every phone ever seen, also the ones that haven't opened the app lately.
create or replace function public.tf_use_devices_all()
returns table (device text, label text, os text, screen text, first_seen timestamptz, last_seen timestamptz)
language plpgsql security definer set search_path = public stable as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  return query select d.device, d.label, d.os, d.screen, d.first_seen, d.last_seen from tf_use_devices d order by d.last_seen desc;
end $$;

-- alex's TestFlight tester names, typed on usage.html, to see who hasn't opened the app with usage turned on yet.
create table if not exists public.tf_use_roster (name text primary key check (char_length(name) between 1 and 60));
alter table public.tf_use_roster enable row level security;   -- no policies: closed to everyone

create or replace function public.tf_use_roster_get() returns setof text
language plpgsql security definer set search_path = public stable as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  return query select name from tf_use_roster order by lower(name);
end $$;

create or replace function public.tf_use_roster_set(names text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  delete from tf_use_roster where true;
  insert into tf_use_roster (name)
    select distinct left(trim(n), 60) from unnest(coalesce(names, '{}')) as n where trim(n) <> '' limit 200
  on conflict do nothing;
end $$;

revoke all on function public.tf_use(text, text, text, jsonb) from public;
revoke all on function public.tf_use_devices_all() from public;
revoke all on function public.tf_use_roster_get() from public;
revoke all on function public.tf_use_roster_set(text[]) from public;
grant execute on function public.tf_use(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.tf_use_devices_all() to authenticated;
grant execute on function public.tf_use_roster_get() to authenticated;
grant execute on function public.tf_use_roster_set(text[]) to authenticated;
