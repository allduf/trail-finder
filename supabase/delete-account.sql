-- Trail Finder "Delete my account": run once in the Supabase SQL Editor (paste, then Run). Safe to run again.
-- Apple requires apps with sign-in to let people delete their account from inside the app (App Store rule 5.1.1).
-- The app (account.js) first removes the rider's own photo files through Storage, then calls delete_my_account(),
-- which deletes the sign-in itself. Every table that keeps a rider's things references auth.users "on delete cascade"
-- (settings, rides, ski_points, trail_grades, trail_reports, trail_photos, rider_trails, rider_trail_votes,
-- strava_links, tf_admins), so those rows go with it. Photo-find matches only "set null" the rider, so they're
-- deleted here first, with their pictures.

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  -- Files the rider uploaded (ride, point and trail photos, photo-find pictures). The app removes its own buckets
  -- through Storage first; this catches anything left. Supabase refuses plain deletes on storage tables unless the
  -- query says it knows what it's doing, and an older project may not have the setting: never let that stop the delete.
  begin
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects where owner = me
      or (bucket_id = 'trail-match-photos' and name in (select photo from public.trail_matches where user_id = me and photo is not null));
  exception when others then null;
  end;
  delete from public.trail_matches where user_id = me;
  delete from auth.users where id = me;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
