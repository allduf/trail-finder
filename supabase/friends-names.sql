-- A name next to each friend's email (alex 2026-11-03: "so i can remember who is who"). Run once in the Supabase SQL
-- editor, after friends.sql. Safe to run again. Only alex (tf_admins) can read or change names, like the rest of the list.

alter table public.tf_friends add column if not exists name text check (char_length(name) <= 80);

-- The list and the add/change function get the name: old versions are dropped first (their shape changes).
drop function if exists public.tf_friend_list();
drop function if exists public.tf_friend_set(text, boolean);

create or replace function public.tf_friend_list() returns table (email text, name text, added_at timestamptz, signed_up boolean)
language plpgsql security definer set search_path = public stable as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  return query select f.email, f.name, f.added_at, exists (select 1 from auth.users u where lower(u.email) = f.email)
    from tf_friends f order by f.added_at;
end $$;

-- add = true: add the friend, or change their name (n). add = false: remove them.
create or replace function public.tf_friend_set(e text, add boolean, n text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m text := lower(trim(e)); nm text := nullif(left(trim(coalesce(n, '')), 80), '');
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  if add then
    insert into tf_friends (email, name) values (m, nm)
    on conflict (email) do update set name = case when n is null then tf_friends.name else nm end;   -- n '' clears the name
  else delete from tf_friends where email = m; end if;
end $$;

revoke all on function public.tf_friend_list() from public, anon;
revoke all on function public.tf_friend_set(text, boolean, text) from public, anon;
grant execute on function public.tf_friend_list() to authenticated;
grant execute on function public.tf_friend_set(text, boolean, text) to authenticated;
