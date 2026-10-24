-- Trail Finder phone notifications (prime loam alerts): run once in the Supabase SQL Editor (paste, then Run).
-- Each phone that turns on notifications saves its push address and the trails it watches through push_save().
-- Nobody can read the table with the public key: only the Loam alerts job (.github/workflows/loam-push.yml,
-- with the secret key) reads it and sends the notifications. Safe to run again.

create table if not exists public.push_subs (
  id uuid primary key,                       -- random id kept on the phone (tf:pushId)
  sub jsonb not null,                        -- the browser's push subscription (endpoint + keys)
  watch jsonb not null default '{}',         -- { t: [{ k, n, c: [lat, lon], w, a }] } the trails this phone watches
  sent jsonb not null default '{}',          -- trail keys already sent while in prime loam (the job keeps it)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The site's push key pair (VAPID). The Loam alerts job makes it on its first run; it must never change after
-- phones subscribe, or their notifications stop.
create table if not exists public.push_keys (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null
);

-- Row level security with no policies: the public key can't read or write either table directly.
alter table public.push_subs enable row level security;
alter table public.push_keys enable row level security;

create or replace function public.push_key() returns text
language sql stable security definer set search_path = public as $$
  select public_key from public.push_keys where id = 1
$$;

create or replace function public.push_save(p_id uuid, p_sub jsonb, p_watch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(left(p_sub->>'endpoint', 8), '') <> 'https://' or length(p_sub::text) > 4000 or length(p_watch::text) > 300000 then
    raise exception 'bad subscription';
  end if;
  -- A new phone: caps for the whole app, so nobody can fill the free database with made-up phones.
  if not exists (select 1 from public.push_subs where id = p_id) and (
       (select count(*) from public.push_subs where created_at > now() - interval '1 hour') >= 50
       or (select count(*) from public.push_subs) >= 1000) then
    raise exception 'busy, try later';
  end if;
  insert into public.push_subs (id, sub, watch, updated_at) values (p_id, p_sub, p_watch, now())
  on conflict (id) do update set sub = excluded.sub, watch = excluded.watch, updated_at = now();
end
$$;

create or replace function public.push_delete(p_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subs where id = p_id
$$;

grant execute on function public.push_key() to anon, authenticated;
grant execute on function public.push_save(uuid, jsonb, jsonb) to anon, authenticated;
grant execute on function public.push_delete(uuid) to anon, authenticated;
