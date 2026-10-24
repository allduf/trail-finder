-- Trail Finder "Help improve Trail Finder": run once in the Supabase SQL Editor (paste, then Run).
-- Riders who turn the switch on (My rides, share.js) send a trimmed copy of each ride's line: no name, no account, no
-- photos, only the month. Each rider has a random key (kept in their settings); the table only stores an md5 of it,
-- so the rows can't be joined back to an account. The app can only add or remove rides through the functions below
-- (with that key); nobody can read the rows from the app. The nightly job (scripts/build-community.mjs, with the
-- secret key) reads them and writes data/community.json: trails riders use that aren't on the map, which way trails
-- are ridden and how busy they are, each only when 3 or more different riders back it up.

create table if not exists public.shared_rides (
  contributor text not null,                 -- md5 of the rider's random key
  ride text not null,                        -- md5 of the key and the ride: lets the rider take one ride back
  month date not null,                       -- first day of the month ridden (never the day or the time)
  ebike boolean not null default false,
  line jsonb not null,                       -- pieces of [lat, lon, seconds since the piece's start]
  points int not null,
  created_at timestamptz not null default now(),
  primary key (contributor, ride)
);
create index if not exists shared_rides_month on public.shared_rides (month);
alter table public.shared_rides enable row level security;   -- no policies: closed to the site
revoke all on public.shared_rides from anon, authenticated;

-- Add (or replace) one ride. Checks the shape and size, and refuses floods from anyone.
create or replace function public.share_ride(p_key uuid, p_ride text, p_month date, p_ebike boolean, p_line jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  piece jsonb;
  who text := md5(p_key::text);
begin
  if p_ride is null or length(p_ride) > 80 then raise exception 'bad ride'; end if;
  if p_month is null or p_month > current_date or p_month < date '2005-01-01' then raise exception 'bad month'; end if;
  if jsonb_typeof(p_line) <> 'array' or jsonb_array_length(p_line) > 50 then raise exception 'bad line'; end if;
  for piece in select * from jsonb_array_elements(p_line) loop
    if jsonb_typeof(piece) <> 'array' then raise exception 'bad line'; end if;
    n := n + jsonb_array_length(piece);
  end loop;
  if n < 20 or n > 8000 then raise exception 'line too short or too long'; end if;
  if (select count(*) from public.shared_rides where contributor = who) >= 5000 then raise exception 'too many rides'; end if;
  if (select count(*) from public.shared_rides where created_at > now() - interval '1 hour') >= 5000 then raise exception 'busy, try later'; end if;
  insert into public.shared_rides (contributor, ride, month, ebike, line, points)
  values (who, md5(p_key::text || p_ride), date_trunc('month', p_month)::date, coalesce(p_ebike, false), p_line, n)
  on conflict (contributor, ride) do update
    set month = excluded.month, ebike = excluded.ebike, line = excluded.line, points = excluded.points, created_at = now();
  return n;
end $$;

-- Take one ride back.
create or replace function public.unshare_ride(p_key uuid, p_ride text)
returns int language sql security definer set search_path = public as $$
  with d as (delete from public.shared_rides where contributor = md5(p_key::text) and ride = md5(p_key::text || p_ride) returning 1)
  select count(*)::int from d;
$$;

-- Delete everything this rider shared.
create or replace function public.unshare_all(p_key uuid)
returns int language sql security definer set search_path = public as $$
  with d as (delete from public.shared_rides where contributor = md5(p_key::text) returning 1)
  select count(*)::int from d;
$$;

-- How many rides this rider has shared.
create or replace function public.shared_count(p_key uuid)
returns int language sql security definer set search_path = public as $$
  select count(*)::int from public.shared_rides where contributor = md5(p_key::text);
$$;

revoke all on function public.share_ride(uuid, text, date, boolean, jsonb) from public;
revoke all on function public.unshare_ride(uuid, text) from public;
revoke all on function public.unshare_all(uuid) from public;
revoke all on function public.shared_count(uuid) from public;
grant execute on function public.share_ride(uuid, text, date, boolean, jsonb) to anon, authenticated;
grant execute on function public.unshare_ride(uuid, text) to anon, authenticated;
grant execute on function public.unshare_all(uuid) to anon, authenticated;
grant execute on function public.shared_count(uuid) to anon, authenticated;
