-- Trail Finder rider grades: run once in the Supabase SQL Editor (paste, then Run).
-- Riders give a trail their own difficulty grade (green, blue, black, double black, pro line); the app shows what riders say.
-- Anyone can read grades (no sign-in needed). Grading needs a signed-in rider, one grade per rider per trail
-- (grading again changes it). Rider emails are never shared: grades only store the user id.

create table if not exists public.trail_grades (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  osm_type text not null check (osm_type in ('way', 'relation')),
  osm_id bigint not null,
  trail_name text check (char_length(trail_name) <= 120),
  grade text not null check (grade in ('green', 'blue', 'black', 'dbl', 'pro')),
  updated_at timestamptz not null default now(),
  primary key (user_id, osm_type, osm_id)
);
create index if not exists trail_grades_trail on public.trail_grades (osm_type, osm_id);

alter table public.trail_grades enable row level security;

drop policy if exists "anyone reads grades" on public.trail_grades;
create policy "anyone reads grades" on public.trail_grades for select to anon, authenticated
  using (true);

drop policy if exists "riders add own grades" on public.trail_grades;
create policy "riders add own grades" on public.trail_grades for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "riders change own grades" on public.trail_grades;
create policy "riders change own grades" on public.trail_grades for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "riders delete own grades" on public.trail_grades;
create policy "riders delete own grades" on public.trail_grades for delete to authenticated
  using (auth.uid() = user_id);

-- How many riders gave each grade, per trail: the app loads this once for the whole map (no user ids in it).
create or replace view public.trail_grade_counts with (security_invoker = true) as
  select osm_type, osm_id, grade, count(*)::int as riders
  from public.trail_grades group by osm_type, osm_id, grade;
grant select on public.trail_grade_counts to anon, authenticated;
