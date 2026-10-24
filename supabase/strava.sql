-- Trail Finder Strava sync: run once in the Supabase SQL Editor (paste, then Run).
-- One row per account that connected Strava (My rides → Connect Strava): the keys Strava gave for that rider, so any
-- device signed in to the account can bring the rider's new Strava rides into My rides. Only the "strava" function
-- (functions/strava, with Supabase's service key) reads or writes it: the site never sees the keys.

create table if not exists public.strava_links (
  user_id uuid primary key references auth.users on delete cascade,
  athlete_id bigint,
  athlete_name text,
  access_token text,
  refresh_token text,
  expires_at bigint,          -- when access_token runs out, seconds since 1970 (as Strava gives it)
  scope text,
  state text,                 -- one-time code while connecting (Strava sends it back with the rider's answer)
  state_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists strava_links_state on public.strava_links (state);
alter table public.strava_links enable row level security;   -- no policies: closed to the site
revoke all on public.strava_links from anon, authenticated;
