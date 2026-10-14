-- Trail Finder accounts: run once in the Supabase SQL Editor (paste, then Run).
-- Each rider can only read and write their own settings, rides and ride photos.

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.rides (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.settings enable row level security;
alter table public.rides enable row level security;

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rides" on public.rides;
create policy "own rides" on public.rides for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Ride photos: private bucket, files under <user id>/<ride id>/.
insert into storage.buckets (id, name, public) values ('ride-photos', 'ride-photos', false)
  on conflict (id) do nothing;

drop policy if exists "own ride photos" on storage.objects;
create policy "own ride photos" on storage.objects for all to authenticated
  using (bucket_id = 'ride-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'ride-photos' and (storage.foldername(name))[1] = auth.uid()::text);
