-- Trail Finder app usage: run once in the Supabase SQL Editor (paste, then Run).
-- The iPhone app (usage.js, never the website) sends what testers open and tap, so alex can see what people really
-- do and make the app more practical. Each phone is a random device code: no name, email, location or photo.
-- Nobody can read the tables directly. Only accounts listed in tf_admins can read the report (usage.html).

create table if not exists public.tf_use_devices (
  device text primary key check (char_length(device) between 8 and 64),
  label text check (char_length(label) <= 60),      -- a name alex gives the phone on usage.html
  os text check (char_length(os) <= 40),
  screen text check (char_length(screen) <= 20),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists public.tf_use_events (
  id bigserial primary key,
  device text not null references public.tf_use_devices (device) on delete cascade,
  session text not null check (char_length(session) <= 40),
  at timestamptz not null,
  page text check (char_length(page) <= 20),
  kind text not null check (kind in ('open', 'tap', 'sport', 'error', 'end')),
  what text check (char_length(what) <= 120),
  ms int
);
create index if not exists tf_use_events_at on public.tf_use_events (at);
create index if not exists tf_use_events_device on public.tf_use_events (device, at);

create table if not exists public.tf_admins (user_id uuid primary key references auth.users (id) on delete cascade);

alter table public.tf_use_devices enable row level security;   -- no policies: closed to everyone
alter table public.tf_use_events enable row level security;
alter table public.tf_admins enable row level security;

-- The app sends a batch of events (at most 200 per call).
create or replace function public.tf_use(device text, os text, screen text, events jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into tf_use_devices (device, os, screen) values (tf_use.device, left(tf_use.os, 40), left(tf_use.screen, 20))
  on conflict (device) do update set os = excluded.os, screen = excluded.screen, last_seen = now();
  insert into tf_use_events (device, session, at, page, kind, what, ms)
  select tf_use.device, left(e->>'s', 40), least(coalesce((e->>'t')::timestamptz, now()), now()), left(e->>'p', 20),
         e->>'k', left(e->>'w', 120), least(greatest((e->>'ms')::int, 0), 86400000)
  from jsonb_array_elements(case when jsonb_typeof(events) = 'array' then events else '[]'::jsonb end)
       with ordinality as x(e, i)
  where x.i <= 200 and e->>'k' in ('open', 'tap', 'sport', 'error', 'end') and coalesce(e->>'s', '') <> '';
end $$;

create or replace function public.tf_is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from tf_admins where user_id = auth.uid());
$$;

-- The report for usage.html: every event of the last N days with the phone's details.
create or replace function public.tf_use_report(days int default 30)
returns table (device text, label text, os text, screen text, session text, at timestamptz, page text, kind text, what text, ms int)
language plpgsql security definer set search_path = public stable as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  return query
    select e.device, d.label, d.os, d.screen, e.session, e.at, e.page, e.kind, e.what, e.ms
    from tf_use_events e join tf_use_devices d using (device)
    where e.at > now() - make_interval(days => least(greatest(days, 1), 365))
    order by e.at;
end $$;

-- Give a phone a name (for example the friend's name from TestFlight).
create or replace function public.tf_use_label(device text, label text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  update tf_use_devices set label = nullif(left(trim(tf_use_label.label), 60), '') where tf_use_devices.device = tf_use_label.device;
end $$;

revoke all on function public.tf_use(text, text, text, jsonb) from public;
revoke all on function public.tf_is_admin() from public;
revoke all on function public.tf_use_report(int) from public;
revoke all on function public.tf_use_label(text, text) from public;
grant execute on function public.tf_use(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.tf_is_admin() to authenticated;
grant execute on function public.tf_use_report(int) to authenticated;
grant execute on function public.tf_use_label(text, text) to authenticated;

-- Last step, once: let your own Trail Finder account read the report. Put the email you sign in to Trail Finder with
-- between the quotes, then run this line on its own.
-- insert into public.tf_admins select id from auth.users where email = 'YOUR EMAIL' on conflict do nothing;
