-- Trail Finder live location (live.js): run once in the Supabase SQL Editor (paste, then Run). Safe to run again.
-- Someone sharing their live location sends where they are every 15 s or so to a group, named by a random code that
-- is in the link they send (#live=<code>). Anyone with the link sees the people in that group on the map: their name
-- as they typed it, where they are, the last hour of their track, when they're due back and their sport. Nothing else.
-- Each sharer also has a random secret kept on their phone, so nobody else can move their dot.
-- Rows are deleted 2 hours after the last update, or as soon as the person taps Stop sharing.
-- Nobody can list the groups: the public key can only call the three functions below, each with a code.

create table if not exists public.live_spots (
  grp text not null check (grp ~ '^[A-Za-z0-9_-]{12,40}$'),     -- the group code (in the link)
  id text not null check (id ~ '^[A-Za-z0-9_-]{8,40}$'),        -- this person's id in the group (public)
  secret text not null check (char_length(secret) between 16 and 80),   -- only their phone knows it
  name text not null default '' check (char_length(name) <= 40),
  sport text not null default '' check (char_length(sport) <= 8),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  acc real,
  speed real,
  due timestamptz,                                                -- when they said they'd be back (optional)
  until timestamptz not null,                                     -- the share ends by itself then
  track jsonb not null default '[]',                              -- [[lat, lon, unix s], ...] the last hour
  stopped boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (grp, id)
);
create index if not exists live_spots_updated on public.live_spots (updated_at);

alter table public.live_spots enable row level security;   -- no policies: closed to the public key

-- Send where I am. A new person in a group: at most 20 in a group, 300 shares at once for the whole app.
-- Updates faster than every 5 s are ignored (returns false), so a stuck phone can't flood the free database.
create or replace function public.live_put(p_grp text, p_id text, p_secret text, p_name text, p_sport text,
  p_lat double precision, p_lon double precision, p_acc real, p_speed real, p_due timestamptz, p_until timestamptz)
returns boolean
language plpgsql security definer set search_path = public as $$
declare r public.live_spots;
begin
  delete from public.live_spots where updated_at < now() - interval '2 hours' or until < now() - interval '10 minutes';
  select * into r from public.live_spots where grp = p_grp and id = p_id;
  if found then
    if r.secret <> p_secret then raise exception 'not yours'; end if;
    if r.updated_at > now() - interval '5 seconds' then return false; end if;
    update public.live_spots set
      name = left(coalesce(p_name, ''), 40), sport = left(coalesce(p_sport, ''), 8),
      lat = p_lat, lon = p_lon, acc = p_acc, speed = p_speed, due = p_due,
      until = least(coalesce(p_until, now() + interval '12 hours'), now() + interval '24 hours'),
      stopped = false, updated_at = now(),
      -- the last hour of the track, a point at most every 20 s, 240 points at most
      track = (select coalesce(jsonb_agg(p order by (p->>2)::bigint), '[]'::jsonb) from (
                 select p from jsonb_array_elements(r.track) p where (p->>2)::bigint > extract(epoch from now())::bigint - 3600
                 order by (p->>2)::bigint desc limit 239) t)
               || case when jsonb_array_length(r.track) = 0
                        or (r.track->-1->>2)::bigint < extract(epoch from now())::bigint - 20
                   then jsonb_build_array(jsonb_build_array(round(p_lat::numeric, 5), round(p_lon::numeric, 5), extract(epoch from now())::bigint))
                   else '[]'::jsonb end
    where grp = p_grp and id = p_id;
  else
    if (select count(*) from public.live_spots where grp = p_grp) >= 20 or (select count(*) from public.live_spots) >= 300 then
      raise exception 'busy, try later';
    end if;
    insert into public.live_spots (grp, id, secret, name, sport, lat, lon, acc, speed, due, until, track)
    values (p_grp, p_id, p_secret, left(coalesce(p_name, ''), 40), left(coalesce(p_sport, ''), 8), p_lat, p_lon, p_acc, p_speed, p_due,
      least(coalesce(p_until, now() + interval '12 hours'), now() + interval '24 hours'),
      jsonb_build_array(jsonb_build_array(round(p_lat::numeric, 5), round(p_lon::numeric, 5), extract(epoch from now())::bigint)));
  end if;
  return true;
end
$$;

-- Stop sharing: the dot disappears for everyone at once.
create or replace function public.live_stop(p_grp text, p_id text, p_secret text) returns void
language sql security definer set search_path = public as $$
  delete from public.live_spots where grp = p_grp and id = p_id and secret = p_secret
$$;

-- Everyone in a group (no secrets).
create or replace function public.live_get(p_grp text) returns table (
  id text, name text, sport text, lat double precision, lon double precision, acc real, speed real,
  due timestamptz, until timestamptz, track jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, name, sport, lat, lon, acc, speed, due, until, track, updated_at from public.live_spots
  where grp = p_grp and until > now() - interval '10 minutes' and updated_at > now() - interval '2 hours'
  order by name
$$;

revoke all on function public.live_put(text, text, text, text, text, double precision, double precision, real, real, timestamptz, timestamptz) from public;
revoke all on function public.live_stop(text, text, text) from public;
revoke all on function public.live_get(text) from public;
grant execute on function public.live_put(text, text, text, text, text, double precision, double precision, real, real, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.live_stop(text, text, text) to anon, authenticated;
grant execute on function public.live_get(text) to anon, authenticated;
