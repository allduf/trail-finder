-- Friends who see unofficial trails (go-public checklist item 8, alex 2026-11-03).
-- Everyone else sees well-known trails as usual, but hidden or risky trails (alex's own unofficial list, trails mapped as
-- closed, private or no bikes, "Likely MTB" paths and possible unmapped lines) are left out of the app for them: no name,
-- no list, no search, no alert, no loop. alex (tf_admins, see usage.sql) is always a friend, and adds friends by email
-- on usage.html. A friend signs in once in the app with that same email.
-- Run once in the Supabase SQL editor, after usage.sql.

create table if not exists public.tf_friends (
  email text primary key check (email = lower(email) and position('@' in email) > 1),
  added_at timestamptz not null default now()
);
-- No policies: nobody reads or writes the table directly, only through the functions below.
alter table public.tf_friends enable row level security;
revoke all on public.tf_friends from anon, authenticated;

-- Is the signed-in rider alex or one of alex's friends? (index.html asks once after each sign-in, friends.js)
create or replace function public.tf_is_friend() returns boolean
language sql security definer set search_path = public stable as $$
  select auth.uid() is not null and (
    tf_is_admin()
    or exists (select 1 from tf_friends f join auth.users u on lower(u.email) = f.email
               where u.id = auth.uid() and u.email_confirmed_at is not null)
  );
$$;

-- alex only: the list, add, remove (usage.html, Friends card).
create or replace function public.tf_friend_list() returns table (email text, added_at timestamptz, signed_up boolean)
language plpgsql security definer set search_path = public stable as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  return query select f.email, f.added_at, exists (select 1 from auth.users u where lower(u.email) = f.email)
    from tf_friends f order by f.added_at;
end $$;

create or replace function public.tf_friend_set(e text, add boolean) returns void
language plpgsql security definer set search_path = public as $$
declare m text := lower(trim(e));
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  if add then insert into tf_friends (email) values (m) on conflict do nothing;
  else delete from tf_friends where email = m; end if;
end $$;

revoke all on function public.tf_friend_list() from public, anon;
revoke all on function public.tf_friend_set(text, boolean) from public, anon;
revoke all on function public.tf_is_friend() from public, anon;
grant execute on function public.tf_is_friend() to authenticated;
grant execute on function public.tf_friend_list() to authenticated;
grant execute on function public.tf_friend_set(text, boolean) to authenticated;
