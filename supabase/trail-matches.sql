-- Trail Finder "Which trail is this?" confirmed matches: run once in the Supabase SQL Editor (paste, then Run).
-- When a rider taps "Yes, that's it" after a photo search, the app saves a small copy of the picture (or one frame of
-- the video) and what led to the match (words read, the rider's description, area, landmarks, GPS spot, AI notes).
-- Anyone using the site can save one (no sign-in needed). Nobody can read the pictures back through the site: the
-- bucket is private with no read policy, so only the project owner sees them in the Supabase dashboard.
-- The app reads back only the trail and the words of past matches, to lift that trail next time similar words come up.

create table if not exists public.trail_matches (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users on delete set null,
  trail_name text not null check (char_length(trail_name) <= 120),
  osm_type text not null default 'way' check (osm_type in ('way', 'relation')),
  osm_ids bigint[] not null check (cardinality(osm_ids) between 1 and 60),
  zone text check (char_length(zone) <= 60),
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  words text check (char_length(words) <= 600),           -- the key words that matched, for lifting this trail later
  method text check (method in ('gps', 'words', 'ai', 'landmark', 'mixed')),
  details jsonb check (pg_column_size(details) <= 20000),   -- text read, description, area, landmarks, GPS spot, AI notes
  photo text check (char_length(photo) <= 200),             -- path in the trail-match-photos bucket
  created_at timestamptz not null default now()
);
create index if not exists trail_matches_recent on public.trail_matches (created_at desc);

alter table public.trail_matches enable row level security;

drop policy if exists "anyone saves a match" on public.trail_matches;
create policy "anyone saves a match" on public.trail_matches for insert to anon, authenticated
  with check ((user_id is null or user_id = auth.uid()) and created_at > now() - interval '5 minutes');

drop policy if exists "anyone reads match words" on public.trail_matches;
create policy "anyone reads match words" on public.trail_matches for select to anon, authenticated using (true);
-- Only these columns can be read back (no details, no photo path, no user id).
revoke select on public.trail_matches from anon, authenticated;
grant select (id, trail_name, osm_type, osm_ids, zone, lat, lon, words, created_at) on public.trail_matches to anon, authenticated;
grant insert on public.trail_matches to anon, authenticated;

-- The pictures: private, small JPEGs only, write-only for the site.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trail-match-photos', 'trail-match-photos', false, 600000, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 600000, allowed_mime_types = array['image/jpeg'];

drop policy if exists "anyone uploads a match photo" on storage.objects;
create policy "anyone uploads a match photo" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'trail-match-photos');
