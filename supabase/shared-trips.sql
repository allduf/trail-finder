-- Trail Finder shared cabin trips (cabin-trip.js, alex 2026-11-11: "share the cabin trip plan with other users so
-- they can add and delete things like the organizer"). Run once in the Supabase SQL Editor (paste, then Run).
--
-- A trip shared with a group is one row: the trip (the cabin, dates, way in, lines, packing list, who brings what,
-- meals, booking, costs, journal notes) as JSON. The link the group gets carries the row's id and a random key; the
-- table keeps only an md5 of the key. Nobody can list or read the rows from the app: only these functions, with the
-- id and the key. No account needed (a friend without one can still join from the link).
-- Each phone merges the group's changes with its own (cabin-trip.js merge3) and writes back only if nobody wrote in
-- between (p_rev), so two people editing at once both keep their changes.
-- Not kept: ticks in the packing list, the trip plan for a friend, photos (they stay on each phone).

create table if not exists public.shared_trips (
  id uuid primary key default gen_random_uuid(),
  secret text not null,                       -- md5 of the link's key
  data jsonb not null,
  rev int not null default 1,
  by text not null default '',               -- the name of who changed it last (as they typed it in the trip)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shared_trips_updated on public.shared_trips (updated_at);
alter table public.shared_trips enable row level security;   -- no policies: closed to the site
revoke all on public.shared_trips from anon, authenticated;

-- A new shared trip: returns its id. Size and flood caps so nobody can fill the free database.
create or replace function public.trip_new(p_key uuid, p_data jsonb, p_by text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if jsonb_typeof(p_data) <> 'object' or p_data->'hut' is null then raise exception 'bad trip'; end if;
  if pg_column_size(p_data) > 400000 then raise exception 'trip too big'; end if;
  if (select count(*) from public.shared_trips where created_at > now() - interval '1 hour') >= 300 then raise exception 'busy, try later'; end if;
  insert into public.shared_trips (secret, data, by) values (md5(p_key::text), p_data, left(coalesce(p_by, ''), 30))
  returning id into new_id;
  return new_id;
end $$;

-- The trip as it is now: { data, rev, by, at }, or null (wrong id or key).
create or replace function public.trip_get(p_id uuid, p_key uuid)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('data', data, 'rev', rev, 'by', by, 'at', updated_at)
  from public.shared_trips where id = p_id and secret = md5(p_key::text);
$$;

-- Write the trip if nobody wrote since p_rev: { ok: true, rev } or { ok: false, rev } (then the phone merges again).
create or replace function public.trip_put(p_id uuid, p_key uuid, p_data jsonb, p_rev int, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r int;
begin
  if jsonb_typeof(p_data) <> 'object' or p_data->'hut' is null then raise exception 'bad trip'; end if;
  if pg_column_size(p_data) > 400000 then raise exception 'trip too big'; end if;
  update public.shared_trips set data = p_data, rev = rev + 1, by = left(coalesce(p_by, ''), 30), updated_at = now()
  where id = p_id and secret = md5(p_key::text) and rev = p_rev
  returning rev into r;
  if r is null then
    select rev into r from public.shared_trips where id = p_id and secret = md5(p_key::text);
    if r is null then raise exception 'no such trip'; end if;
    return jsonb_build_object('ok', false, 'rev', r);
  end if;
  return jsonb_build_object('ok', true, 'rev', r);
end $$;

revoke all on function public.trip_new(uuid, jsonb, text) from public;
revoke all on function public.trip_get(uuid, uuid) from public;
revoke all on function public.trip_put(uuid, uuid, jsonb, int, text) from public;
grant execute on function public.trip_new(uuid, jsonb, text) to anon, authenticated;
grant execute on function public.trip_get(uuid, uuid) to anon, authenticated;
grant execute on function public.trip_put(uuid, uuid, jsonb, int, text) to anon, authenticated;

-- To clear old trips some day (their phones keep their own copies):
--   delete from public.shared_trips where updated_at < now() - interval '1 year';
