-- Limits on what anyone can write without an account (security check 2026-11-21).
-- Run once in Supabase → SQL Editor (after the other files; it only replaces functions and adds one small table).
-- Safe to run again.
--
-- Why: the functions the site calls without an account (shared trips, alerts, usage counts, I agree records, visit
-- counts, shared ride lines) had at most an hourly limit for everyone together. One script could fill the free
-- 500 MB database in a few hours, and Supabase then stops every write (sign-ins keep working, saving doesn't).
-- Now:
--  - each internet address gets a daily allowance per kind (one counter a day, kept as a one-way hash, deleted after
--    2 days). There is no shared allowance for everyone together, so one person can't use it up for everybody;
--  - the backstop: when the database is over 400 MB, writes without an account stop (accounts keep saving, and
--    I agree records are always kept);
--  - new alert addresses must be a real browser push service or an Apple device token.
-- The numbers are far above what one phone or one family's Wi-Fi uses in a day. Usage counts and visit counts are
-- dropped quietly over the allowance (a busy shared Wi-Fi may count a bit low); the rest says "busy, try later".

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.tf_limit_counts (
  kind text not null,
  who text not null,                         -- sha256 of the kind, the internet address and a fixed word: not reversible to the address
  day date not null default current_date,
  n int not null default 0,
  primary key (kind, who, day)
);
alter table public.tf_limit_counts enable row level security;   -- no policies: closed to the site
revoke all on public.tf_limit_counts from anon, authenticated;

-- The caller's internet address: Cloudflare (in front of Supabase) sets cf-connecting-ip itself, so a caller can't
-- choose it; x-forwarded-for's first entry is only the fallback (a caller could choose that one, so the database-size
-- backstop below still holds if they do).
create or replace function public.tf_client_ip() returns text
language plpgsql stable security definer set search_path = public as $$
declare h json := nullif(current_setting('request.headers', true), '')::json;
begin
  return coalesce(nullif(trim(h->>'cf-connecting-ip'), ''), nullif(trim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''), 'none');
exception when others then return 'none';
end $$;

-- true: under today's allowance for this address; counts this call (one row a day per address and kind).
create or replace function public.tf_limit(k text, per_who int) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare h text := encode(digest(k || '|' || tf_client_ip() || '|tf-limit', 'sha256'), 'hex'); v int;
begin
  if random() < 0.01 then delete from tf_limit_counts where day < current_date - 1; end if;
  insert into tf_limit_counts as c (kind, who, day, n) values (k, h, current_date, 1)
    on conflict (kind, who, day) do update set n = c.n + 1
    returning n into v;
  return v <= per_who;
end $$;

-- Room left in the database for writes without an account (the free plan's limit is 500 MB).
create or replace function public.tf_db_room() returns boolean
language sql stable security definer set search_path = public as $$
  select pg_database_size(current_database()) < 400 * 1024 * 1024
$$;

revoke all on function public.tf_client_ip() from public, anon, authenticated;
drop function if exists public.tf_limit(text, int, int);
revoke all on function public.tf_limit(text, int) from public, anon, authenticated;
revoke all on function public.tf_db_room() from public, anon, authenticated;

-- ---------- shared trips (shared-trips.sql): 30 new trips a day per address ----------
create or replace function public.trip_new(p_key uuid, p_data jsonb, p_by text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if jsonb_typeof(p_data) <> 'object' or p_data->'hut' is null then raise exception 'bad trip'; end if;
  if pg_column_size(p_data) > 400000 then raise exception 'trip too big'; end if;
  if not tf_db_room() or not tf_limit('trip', 30) then raise exception 'busy, try later'; end if;
  if (select count(*) from public.shared_trips where created_at > now() - interval '1 hour') >= 300 then raise exception 'busy, try later'; end if;
  insert into public.shared_trips (secret, data, by) values (md5(p_key::text), p_data, left(coalesce(p_by, ''), 30))
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.trip_new(uuid, jsonb, text) from public;
grant execute on function public.trip_new(uuid, jsonb, text) to anon, authenticated;

-- ---------- alerts (push.sql): new phones only from real push services, 10 a day per address ----------
create or replace function public.push_save(p_id uuid, p_sub jsonb, p_watch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(left(p_sub->>'endpoint', 8), '') <> 'https://' or length(p_sub::text) > 4000 or length(p_watch::text) > 300000 then
    raise exception 'bad subscription';
  end if;
  if not exists (select 1 from public.push_subs where id = p_id) then
    -- A new phone (phones already saved keep working as they are).
    if coalesce(p_sub->>'endpoint', '') !~ '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)/'
       or (p_sub ? 'apns' and coalesce(p_sub->>'apns', '') !~ '^[0-9A-Fa-f]{64,200}$') then
      raise exception 'bad subscription';
    end if;
    if not tf_db_room() or not tf_limit('push', 10)
       or (select count(*) from public.push_subs where created_at > now() - interval '1 hour') >= 50
       or (select count(*) from public.push_subs) >= 1000 then
      raise exception 'busy, try later';
    end if;
  end if;
  insert into public.push_subs (id, sub, watch, updated_at) values (p_id, p_sub, p_watch, now())
  on conflict (id) do update set sub = excluded.sub, watch = excluded.watch, updated_at = now();
end
$$;
grant execute on function public.push_save(uuid, jsonb, jsonb) to anon, authenticated;

-- ---------- how the app is used (usage.js sends every 30 s while used, ~2,900 a day per phone): 15,000 a day per address ----------
create or replace function public.tf_use(device text, os text, screen text, events jsonb) returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not tf_db_room() or not tf_limit('use', 15000) then return; end if;   -- quietly: usage counts are optional
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
revoke all on function public.tf_use(text, text, text, jsonb) from public;
grant execute on function public.tf_use(text, text, text, jsonb) to anon, authenticated;

-- ---------- I agree records (agreements.sql): 200 a day per address ----------
-- Never refused for lack of room: the proof of an I agree matters more than the limit (each row is tiny).
create or replace function public.tf_agree(device text, what text, v int, season int, agreed_at timestamptz, lang text)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not tf_limit('agree', 200) then return; end if;
  insert into public.tf_agreements (device, user_id, what, v, season, agreed_at, lang)
  values (tf_agree.device, auth.uid(), tf_agree.what, tf_agree.v, coalesce(tf_agree.season, 0),
          least(coalesce(tf_agree.agreed_at, now()), now()), left(tf_agree.lang, 10))
  on conflict (device, what, v, season) do update
    set user_id = coalesce(public.tf_agreements.user_id, excluded.user_id);
end $$;
revoke all on function public.tf_agree(text, text, int, int, timestamptz, text) from public;
grant execute on function public.tf_agree(text, text, int, int, timestamptz, text) to anon, authenticated;

-- ---------- visit counts (visitors-kind.sql): 2,000 a day per address ----------
create or replace function public.tf_ping(device text, kind text default null) returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare k text := case when tf_ping.kind in ('app', 'phone', 'computer') then tf_ping.kind end;
begin
  if not tf_db_room() or not tf_limit('ping', 2000) then return; end if;
  insert into tf_visits (device, kind) values (tf_ping.device, k)
  on conflict (device) do update set last_seen = current_date, kind = coalesce(excluded.kind, tf_visits.kind);
  if k is not null then
    insert into tf_visit_days (device, day, kind) values (tf_ping.device, current_date, k)
    on conflict (device, day) do update set kind = excluded.kind;
  end if;
end $$;
revoke all on function public.tf_ping(text, text) from public;
grant execute on function public.tf_ping(text, text) to anon, authenticated;

-- ---------- shared ride lines (ride-share.sql): 300 a day per address ----------
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
  if not tf_db_room() or not tf_limit('ride', 300) then raise exception 'busy, try later'; end if;
  if (select count(*) from public.shared_rides where contributor = who) >= 5000 then raise exception 'too many rides'; end if;
  if (select count(*) from public.shared_rides where created_at > now() - interval '1 hour') >= 1000 then raise exception 'busy, try later'; end if;
  if (select coalesce(sum(points), 0) from public.shared_rides where created_at > now() - interval '1 day') >= 1500000 then raise exception 'busy, try later'; end if;
  insert into public.shared_rides (contributor, ride, month, ebike, line, points)
  values (who, md5(p_key::text || p_ride), date_trunc('month', p_month)::date, coalesce(p_ebike, false), p_line, n)
  on conflict (contributor, ride) do update
    set month = excluded.month, ebike = excluded.ebike, line = excluded.line, points = excluded.points, created_at = now();
  return n;
end $$;
revoke all on function public.share_ride(uuid, text, date, boolean, jsonb) from public;
grant execute on function public.share_ride(uuid, text, date, boolean, jsonb) to anon, authenticated;

-- ---------- photo buckets that had no size limit (setup.sql, ski-points.sql) ----------
-- The app shrinks photos to well under 2 MB before it saves them (a phone that can't read one keeps the original):
-- 10 MB leaves room. Pictures only.
update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  where id in ('ride-photos', 'point-photos');

-- Check: 5 rows that say ok.
select 'limits' as what, case when to_regprocedure('public.tf_limit(text, integer)') is not null then 'ok' else 'not done' end as result
union all select 'anon cannot call tf_limit', case when has_function_privilege('anon', 'public.tf_limit(text, integer)', 'execute') then 'NOT OK' else 'ok' end
union all select 'anon cannot read counts', case when has_table_privilege('anon', 'public.tf_limit_counts', 'select') then 'NOT OK' else 'ok' end
union all select 'room now', case when public.tf_db_room() then 'ok' else 'database over 400 MB' end
union all select 'photo buckets limited', case when (select count(*) from storage.buckets where id in ('ride-photos', 'point-photos') and file_size_limit is not null) = 2 then 'ok' else 'not done' end;
