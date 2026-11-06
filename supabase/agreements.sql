-- Proof of "I agree": run once in the Supabase SQL Editor (paste, then Run). Safest way liability review, 2026-11-06.
-- Each time a device taps I agree to the terms (risk.js tfTerms) or I understand and accept on a risk sheet (tfRiskOk:
-- avy once each winter, offtrail, route), risk.js sends the device code, what was agreed, its version, the winter (avy
-- only) and when. Signed in, the account is kept with it (auth.uid() from the sign-in token, never sent by the app).
-- Nobody can read the table with the app's key; it's there to show, if ever needed, that a person agreed.
-- Kept 15 years (the longest a claim can be made in BC); deleting an account keeps the row without the account.

create table if not exists public.tf_agreements (
  id bigserial primary key,
  device text not null check (char_length(device) between 8 and 64),
  user_id uuid references auth.users (id) on delete set null,
  what text not null check (what in ('terms', 'avy', 'offtrail', 'route')),
  v int not null check (v between 1 and 1000),
  season int not null default 0 check (season between 0 and 3000),
  agreed_at timestamptz not null,
  saved_at timestamptz not null default now(),
  lang text check (char_length(lang) <= 10),
  unique (device, what, v, season)
);

alter table public.tf_agreements enable row level security;   -- no policies: closed to everyone

create or replace function public.tf_agree(device text, what text, v int, season int, agreed_at timestamptz, lang text)
returns void language sql security definer set search_path = public as $$
  insert into public.tf_agreements (device, user_id, what, v, season, agreed_at, lang)
  values (tf_agree.device, auth.uid(), tf_agree.what, tf_agree.v, coalesce(tf_agree.season, 0),
          least(coalesce(tf_agree.agreed_at, now()), now()), left(tf_agree.lang, 10))
  on conflict (device, what, v, season) do update
    set user_id = coalesce(public.tf_agreements.user_id, excluded.user_id);
$$;

revoke all on function public.tf_agree(text, text, int, int, timestamptz, text) from public;
grant execute on function public.tf_agree(text, text, int, int, timestamptz, text) to anon, authenticated;
