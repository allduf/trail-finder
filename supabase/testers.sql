-- Early testers: the "Join the test" page (join.html) and Send feedback (More, every sport, feedback.js).
-- Run once in the Supabase SQL Editor (paste, then Run), after usage.sql (it needs tf_admins and tf_is_admin).
-- Nobody can read either table directly. Only accounts listed in tf_admins read them, on usage.html → Manage.
-- There is no public TestFlight or Play link anywhere: alex adds each person by hand (TestFlight Friends group,
-- Play closed test), so a sign-up is a request, not access.
-- Spam guard: a hidden field bots fill in, a minimum time on the form, and a cap per connection and per day.
-- The connection is kept only as a one-way hash, and those rows are deleted after 2 days.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.tf_join (
  id bigint generated always as identity primary key,
  email text not null unique check (email = lower(email) and char_length(email) between 6 and 120 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text not null check (phone in ('iphone', 'android', 'both')),
  sports text[] not null default '{}' check (cardinality(sports) <= 10),
  area text check (char_length(area) <= 60),            -- where they go out, typed by them (a town or region)
  lang text check (lang in ('en', 'fr')),
  status text not null default 'new' check (status in ('new', 'added', 'no')),   -- alex marks who he added
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tf_feedback (
  id bigint generated always as identity primary key,
  body text not null check (char_length(body) between 1 and 1000),
  shot text check (char_length(shot) <= 700000 and shot like 'data:image/jpeg;base64,%'),   -- a shrunk picture, optional
  sport text check (char_length(sport) <= 10),
  app_v text check (char_length(app_v) <= 20),
  platform text check (char_length(platform) <= 60),    -- "iPhone app", "Android app" or "Website", with the system
  page text check (char_length(page) <= 20),
  lang text check (lang in ('en', 'fr')),
  user_id uuid references auth.users (id) on delete set null default auth.uid(),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- Spam guard: one row per form sent, by a hash of the connection. Pruned after 2 days.
create table if not exists public.tf_form_hits (
  kind text not null,
  who text not null,
  at timestamptz not null default now()
);
create index if not exists tf_form_hits_at on public.tf_form_hits (kind, at);

alter table public.tf_join enable row level security;        -- no policies: closed to everyone
alter table public.tf_feedback enable row level security;
alter table public.tf_form_hits enable row level security;
revoke all on public.tf_join, public.tf_feedback, public.tf_form_hits from anon, authenticated;

-- true when this connection may send one more form of this kind (and counts it).
create or replace function public.tf_form_ok(k text, per_who int, per_day int) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  ip text := split_part(coalesce(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ''), ',', 1);
  h text := encode(digest(k || '|' || coalesce(nullif(trim(ip), ''), 'none') || '|tf-forms', 'sha256'), 'hex');
begin
  delete from tf_form_hits where at < now() - interval '2 days';
  if (select count(*) from tf_form_hits where kind = k and who = h and at > now() - interval '1 day') >= per_who then return false; end if;
  if (select count(*) from tf_form_hits where kind = k and at > now() - interval '1 day') >= per_day then return false; end if;
  insert into tf_form_hits (kind, who) values (k, h);
  return true;
end $$;
revoke all on function public.tf_form_ok(text, int, int) from public, anon, authenticated;

-- join.html: ask to join the test. hp = the hidden field (must be empty), ms = time spent on the form.
-- The same email again updates the request. The answer never says whether an email was already there.
create or replace function public.tf_join_add(email text, phone text, sports text[], area text, lang text, hp text, ms int)
returns text
language plpgsql security definer set search_path = public as $$
declare m text := lower(trim(tf_join_add.email));
begin
  if coalesce(hp, '') <> '' or coalesce(ms, 0) < 3000 then return 'ok'; end if;   -- a bot: say ok, keep nothing
  if m !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(m) > 120 then return 'email'; end if;
  if tf_join_add.phone not in ('iphone', 'android', 'both') then return 'phone'; end if;
  if not tf_form_ok('join', 5, 300) then return 'busy'; end if;
  insert into tf_join (email, phone, sports, area, lang)
  values (m, tf_join_add.phone,
          (select coalesce(array_agg(distinct s), '{}') from unnest(coalesce(tf_join_add.sports, '{}')) s
             where s in ('mtb', 'ski', 'hike', 'fish', 'hunt', 'moto')),
          nullif(left(trim(coalesce(tf_join_add.area, '')), 60), ''),
          case when tf_join_add.lang = 'fr' then 'fr' else 'en' end)
  on conflict (email) do update set phone = excluded.phone, sports = excluded.sports, area = excluded.area,
    lang = excluded.lang, updated_at = now();
  return 'ok';
end $$;
revoke all on function public.tf_join_add(text, text, text[], text, text, text, int) from public;
grant execute on function public.tf_join_add(text, text, text[], text, text, text, int) to anon, authenticated;

-- feedback.js: Send feedback from the app (More, every sport).
create or replace function public.tf_feedback_add(body text, shot text, sport text, app_v text, platform text, page text, lang text, hp text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(hp, '') <> '' then return 'ok'; end if;
  if char_length(trim(coalesce(body, ''))) < 2 then return 'empty'; end if;
  if shot is not null and (char_length(shot) > 700000 or shot not like 'data:image/jpeg;base64,%') then shot := null; end if;
  if not tf_form_ok('feedback', 20, 500) then return 'busy'; end if;
  insert into tf_feedback (body, shot, sport, app_v, platform, page, lang)
  values (left(trim(body), 1000), shot, left(sport, 10), left(app_v, 20), left(platform, 60), left(page, 20),
          case when lang = 'fr' then 'fr' else 'en' end);
  return 'ok';
end $$;
revoke all on function public.tf_feedback_add(text, text, text, text, text, text, text, text) from public;
grant execute on function public.tf_feedback_add(text, text, text, text, text, text, text, text) to anon, authenticated;

-- alex only (usage.html → Manage): the lists, mark, delete.
create or replace function public.tf_join_list()
returns table (id bigint, email text, phone text, sports text[], area text, lang text, status text, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  return query select j.id, j.email, j.phone, j.sports, j.area, j.lang, j.status, j.created_at, j.updated_at
    from tf_join j order by j.created_at desc;
end $$;

create or replace function public.tf_join_set(id bigint, status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  if status = 'delete' then delete from tf_join j where j.id = tf_join_set.id; return; end if;
  update tf_join j set status = tf_join_set.status, updated_at = now() where j.id = tf_join_set.id;
end $$;

create or replace function public.tf_feedback_list()
returns table (id bigint, body text, shot text, sport text, app_v text, platform text, page text, lang text, signed_in boolean, done boolean, created_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  return query select f.id, f.body, f.shot, f.sport, f.app_v, f.platform, f.page, f.lang, f.user_id is not null, f.done, f.created_at
    from tf_feedback f order by f.created_at desc limit 300;
end $$;

create or replace function public.tf_feedback_set(id bigint, done boolean, remove boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  if remove then delete from tf_feedback f where f.id = tf_feedback_set.id; return; end if;
  update tf_feedback f set done = tf_feedback_set.done where f.id = tf_feedback_set.id;
end $$;

revoke all on function public.tf_join_list() from public, anon;
revoke all on function public.tf_join_set(bigint, text) from public, anon;
revoke all on function public.tf_feedback_list() from public, anon;
revoke all on function public.tf_feedback_set(bigint, boolean, boolean) from public, anon;
grant execute on function public.tf_join_list() to authenticated;
grant execute on function public.tf_join_set(bigint, text) to authenticated;
grant execute on function public.tf_feedback_list() to authenticated;
grant execute on function public.tf_feedback_set(bigint, boolean, boolean) to authenticated;
