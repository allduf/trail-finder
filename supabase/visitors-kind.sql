-- Trail Finder head count, part 2: run once in the Supabase SQL Editor (paste, then Run), after visitors.sql.
-- The daily ping (visitors.js) also says how the device opened Trail Finder: "app" (the iPhone app), "phone" (the
-- website on a phone or tablet) or "computer" (the website on a computer). One row per device per day is kept, with
-- no name, location or IP address. Only accounts in tf_admins (usage.sql) can read it, on usage.html. Safe to run again.

alter table public.tf_visits add column if not exists kind text;

create table if not exists public.tf_visit_days (
  device text not null check (char_length(device) between 8 and 64),
  day date not null default current_date,
  kind text not null check (kind in ('app', 'phone', 'computer')),
  primary key (device, day)
);
alter table public.tf_visit_days enable row level security;   -- no policies: closed to everyone

-- Old pages send only the device; new ones add the kind.
drop function if exists public.tf_ping(text);
create or replace function public.tf_ping(device text, kind text default null) returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare k text := case when tf_ping.kind in ('app', 'phone', 'computer') then tf_ping.kind end;
begin
  insert into tf_visits (device, kind) values (tf_ping.device, k)
  on conflict (device) do update set last_seen = current_date, kind = coalesce(excluded.kind, tf_visits.kind);
  if k is not null then
    insert into tf_visit_days (device, day, kind) values (tf_ping.device, current_date, k)
    on conflict (device, day) do update set kind = excluded.kind;
  end if;
end $$;

-- For usage.html: each device seen in the last few days, how it opened Trail Finder and on how many days.
create or replace function public.tf_visits_by_kind(days int default 30)
returns table (device text, kind text, days_used int, last_day date)
language plpgsql security definer set search_path = public stable as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  return query select v.device, v.kind, count(*)::int, max(v.day) from tf_visit_days v
    where v.day > current_date - least(greatest(days, 1), 365) group by v.device, v.kind;
end $$;

revoke all on function public.tf_ping(text, text) from public;
revoke all on function public.tf_visits_by_kind(int) from public;
grant execute on function public.tf_ping(text, text) to anon, authenticated;
grant execute on function public.tf_visits_by_kind(int) to authenticated;
