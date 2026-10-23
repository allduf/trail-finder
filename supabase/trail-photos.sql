-- Trail Finder rider photos on a trail: run once in the Supabase SQL Editor (paste, then Run).
-- Anyone can see the photos (no sign-in needed). Adding one needs a signed-in rider, to keep spam out.
-- Riders can delete their own photos. Photos are shrunk on the phone first (about 1600 px, 200-400 KB each).
-- The find-by-photo function (functions/which-trail) also compares a rider's picture with these.

create table if not exists public.trail_photos (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  osm_type text not null check (osm_type in ('way', 'relation')),
  osm_id bigint not null,
  trail_name text check (char_length(trail_name) <= 120),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  path text not null check (char_length(path) <= 200),
  caption text check (char_length(caption) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists trail_photos_trail on public.trail_photos (osm_type, osm_id, created_at desc);
create index if not exists trail_photos_name on public.trail_photos (trail_name);

alter table public.trail_photos enable row level security;

drop policy if exists "anyone sees trail photos" on public.trail_photos;
create policy "anyone sees trail photos" on public.trail_photos for select to anon, authenticated
  using (true);

drop policy if exists "riders add own trail photos" on public.trail_photos;
create policy "riders add own trail photos" on public.trail_photos for insert to authenticated
  with check (auth.uid() = user_id and created_at > now() - interval '5 minutes' and path like auth.uid()::text || '/%');

drop policy if exists "riders delete own trail photos" on public.trail_photos;
create policy "riders delete own trail photos" on public.trail_photos for delete to authenticated
  using (auth.uid() = user_id);

-- The pictures: a public bucket (so the app can show them without signing in), files under <user id>/.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('trail-photos', 'trail-photos', true, 1048576, array['image/jpeg'])
  on conflict (id) do nothing;

drop policy if exists "riders upload own trail photos" on storage.objects;
create policy "riders upload own trail photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'trail-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "riders delete own trail photo files" on storage.objects;
create policy "riders delete own trail photo files" on storage.objects for delete to authenticated
  using (bucket_id = 'trail-photos' and (storage.foldername(name))[1] = auth.uid()::text);
