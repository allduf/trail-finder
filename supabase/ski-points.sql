-- Trail Finder saved ski points: run once in the Supabase SQL Editor (paste, then Run).
-- Each skier can only read and write their own points and point photos (ski-points.js).

create table if not exists public.ski_points (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.ski_points enable row level security;

drop policy if exists "own ski points" on public.ski_points;
create policy "own ski points" on public.ski_points for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Point photos: private bucket, files under <user id>/.
insert into storage.buckets (id, name, public) values ('point-photos', 'point-photos', false)
  on conflict (id) do nothing;

drop policy if exists "own point photos" on storage.objects;
create policy "own point photos" on storage.objects for all to authenticated
  using (bucket_id = 'point-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'point-photos' and (storage.foldername(name))[1] = auth.uid()::text);
