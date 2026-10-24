-- Trail Finder rider-added trails: run once in the Supabase SQL Editor (paste, then Run).
-- A signed-in rider adds a trail they know that isn't on the map (drawn on the map, from a ride, or from a GPX file),
-- with a name, level, direction and notes (rider-trails.js). Everyone sees it, marked "Added by a rider"; seeing them
-- needs no sign-in. Rider emails and user ids are never shared: the app reads the trails through rider_trails_all(),
-- which leaves the user id out.
-- Other riders can say "I rode it" or report it (not a trail, private, closed, wrong place, already on the map). A trail
-- with 3 or more reports, and more reports than riders who rode it, stops showing. alex can hide any trail by ticking
-- "blocked" in the Table Editor (table rider_trails), or show it again by unticking it.

create table if not exists public.rider_trails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  level text not null default 'unknown' check (level in ('green', 'blue', 'black', 'dbl', 'pro', 'unknown')),
  direction text not null default 'unknown' check (direction in ('oneway', 'both', 'unknown')),
  notes text check (char_length(notes) <= 600),
  line jsonb not null,                       -- [[lat, lon], ...] from the start to the end, the way it's ridden
  length_m int not null check (length_m between 30 and 50000),
  lat double precision not null check (lat between -90 and 90),     -- the middle of the line
  lon double precision not null check (lon between -180 and 180),
  source text not null default 'draw' check (source in ('draw', 'gpx', 'ride')),
  blocked boolean not null default false,    -- ticked by alex: hidden from everyone
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rider_trails_user on public.rider_trails (user_id);
create index if not exists rider_trails_recent on public.rider_trails (created_at desc);

-- Checks the line, stops floods, and keeps riders from changing who added a trail, when, or whether it's blocked.
-- (Changes from the Table Editor or the SQL Editor have no rider, so alex can still block and unblock.)
create or replace function public.rider_trail_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare p jsonb;
begin
  if jsonb_typeof(new.line) <> 'array' or jsonb_array_length(new.line) < 2 or jsonb_array_length(new.line) > 1000 then
    raise exception 'The line needs 2 to 1000 points';
  end if;
  for p in select * from jsonb_array_elements(new.line) loop
    if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2 or jsonb_typeof(p->0) <> 'number' or jsonb_typeof(p->1) <> 'number'
       or abs((p->>0)::float8) > 90 or abs((p->>1)::float8) > 180 then
      raise exception 'Bad point in the line';
    end if;
  end loop;
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      if (select count(*) from public.rider_trails where user_id = new.user_id and created_at > now() - interval '1 day') >= 20 then
        raise exception 'You added 20 trails today: try again tomorrow';
      end if;
      if (select count(*) from public.rider_trails where user_id = new.user_id) >= 500 then raise exception 'Too many trails'; end if;
      if (select count(*) from public.rider_trails where created_at > now() - interval '1 hour') >= 300 then raise exception 'Busy, try again later'; end if;
      new.created_at := now(); new.blocked := false;
    else
      new.user_id := old.user_id; new.created_at := old.created_at; new.blocked := old.blocked;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists rider_trail_check on public.rider_trails;
create trigger rider_trail_check before insert or update on public.rider_trails
  for each row execute function public.rider_trail_check();

alter table public.rider_trails enable row level security;

-- Riders read, add, change and delete their own trails here; everyone else reads them through rider_trails_all().
drop policy if exists "riders read own trails" on public.rider_trails;
create policy "riders read own trails" on public.rider_trails for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "riders add own trails" on public.rider_trails;
create policy "riders add own trails" on public.rider_trails for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "riders change own trails" on public.rider_trails;
create policy "riders change own trails" on public.rider_trails for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "riders delete own trails" on public.rider_trails;
create policy "riders delete own trails" on public.rider_trails for delete to authenticated
  using (auth.uid() = user_id);

-- "I rode it" and reports: one per rider per trail (a new one replaces the old), never on your own trail.
create table if not exists public.rider_trail_votes (
  trail_id uuid not null references public.rider_trails on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('rode', 'report')),
  reason text check (reason in ('not_a_trail', 'private', 'closed', 'wrong_place', 'on_map', 'other')),
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now(),
  primary key (trail_id, user_id)
);
alter table public.rider_trail_votes enable row level security;

drop policy if exists "riders read own votes" on public.rider_trail_votes;
create policy "riders read own votes" on public.rider_trail_votes for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "riders add own votes" on public.rider_trail_votes;
create policy "riders add own votes" on public.rider_trail_votes for insert to authenticated
  with check (auth.uid() = user_id and not exists (select 1 from public.rider_trails t where t.id = trail_id and t.user_id = auth.uid()));
drop policy if exists "riders change own votes" on public.rider_trail_votes;
create policy "riders change own votes" on public.rider_trail_votes for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "riders delete own votes" on public.rider_trail_votes;
create policy "riders delete own votes" on public.rider_trail_votes for delete to authenticated
  using (auth.uid() = user_id);

-- Every trail that shows, with how many riders rode it and reported it (no user ids).
create or replace function public.rider_trails_all()
returns table (id uuid, name text, level text, direction text, notes text, line jsonb, length_m int, lat float8, lon float8,
  source text, created_at timestamptz, updated_at timestamptz, rode int, reports int)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.level, t.direction, t.notes, t.line, t.length_m, t.lat, t.lon, t.source, t.created_at, t.updated_at,
    coalesce(v.rode, 0), coalesce(v.reports, 0)
  from public.rider_trails t
  left join (select trail_id, count(*) filter (where kind = 'rode')::int as rode, count(*) filter (where kind = 'report')::int as reports
             from public.rider_trail_votes group by trail_id) v on v.trail_id = t.id
  where not t.blocked and not (coalesce(v.reports, 0) >= 3 and coalesce(v.reports, 0) > coalesce(v.rode, 0))
  order by t.created_at desc;
$$;
revoke all on function public.rider_trails_all() from public;
grant execute on function public.rider_trails_all() to anon, authenticated;
