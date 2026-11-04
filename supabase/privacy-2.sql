-- Trail Finder privacy, part 2 (alex 2026-11-03: signed-out visitors may only see rider grade totals and what people
-- post on a trail). Run once in the Supabase SQL Editor (paste, then Run). Safe to run again.
--
-- Photo search matches ("Yes, that's it"): the app reads back past matches to find the same trail faster next time.
-- Until now anyone could also read WHEN each match was made, which tells when someone was on that trail. The date is
-- now hidden too; only the trail, its area, the spot on the trail and the words that matched can be read (no account,
-- no picture, no date). The app now orders them by their number instead of their date.
revoke select on public.trail_matches from anon, authenticated;
grant select (id, trail_name, osm_type, osm_ids, zone, lat, lon, words) on public.trail_matches to anon, authenticated;

-- Check (shows "ok" when done).
select case when has_column_privilege('anon', 'public.trail_matches', 'created_at', 'select') then 'not done' else 'ok' end as match_dates_hidden;
