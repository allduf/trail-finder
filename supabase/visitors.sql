-- Trail Finder head count: run once in the Supabase SQL Editor (paste, then Run).
-- The site sends a random device id at most once a day (visitors.js). Only the id and the last day
-- it was seen are kept. Nobody can read the table; the only thing anyone can ask is the number of
-- devices seen in the last few days (tf_active_devices), which the people-count job uses.

create table if not exists public.tf_visits (
  device text primary key check (char_length(device) between 8 and 64),
  first_seen date not null default current_date,
  last_seen date not null default current_date
);

alter table public.tf_visits enable row level security;   -- no policies: the table itself is closed to everyone

create or replace function public.tf_ping(device text) returns void
language sql security definer set search_path = public as $$
  insert into public.tf_visits (device) values (tf_ping.device)
  on conflict (device) do update set last_seen = current_date;
$$;

create or replace function public.tf_active_devices(days int default 30) returns int
language sql security definer set search_path = public stable as $$
  select count(*)::int from public.tf_visits where last_seen > current_date - least(greatest(days, 1), 365);
$$;

revoke all on function public.tf_ping(text) from public;
revoke all on function public.tf_active_devices(int) from public;
grant execute on function public.tf_ping(text) to anon, authenticated;
grant execute on function public.tf_active_devices(int) to anon, authenticated;
