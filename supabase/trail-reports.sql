-- Trail Finder trail condition reports: run once in the Supabase SQL Editor (paste, then Run).
-- Anyone can read reports (no sign-in needed to see them). Posting needs a signed-in rider, to keep spam out.
-- Riders can delete their own reports. Rider emails are never shared: reports only store the user id.

create table if not exists public.trail_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  osm_type text not null check (osm_type in ('way', 'relation')),
  osm_id bigint not null,
  trail_name text check (char_length(trail_name) <= 120),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  condition text not null check (condition in ('dry', 'tacky', 'muddy', 'trees_down', 'snow', 'closed')),
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now()
);
create index if not exists trail_reports_trail on public.trail_reports (osm_type, osm_id, created_at desc);
create index if not exists trail_reports_recent on public.trail_reports (created_at desc);

alter table public.trail_reports enable row level security;

drop policy if exists "anyone reads reports" on public.trail_reports;
create policy "anyone reads reports" on public.trail_reports for select to anon, authenticated
  using (true);

drop policy if exists "riders post own reports" on public.trail_reports;
create policy "riders post own reports" on public.trail_reports for insert to authenticated
  with check (auth.uid() = user_id and created_at > now() - interval '5 minutes');

drop policy if exists "riders delete own reports" on public.trail_reports;
create policy "riders delete own reports" on public.trail_reports for delete to authenticated
  using (auth.uid() = user_id);
