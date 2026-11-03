-- Trail Finder privacy check (2026-11-03): run once in the Supabase SQL Editor (paste, then Run). Safe to run again.
--
-- Rider grades: until now anyone could download every single grade with the account id that gave it, so one could
-- list every trail a given account had graded (a map of where that person rides). Now each rider reads only their own
-- grades; the app still shows everyone how many riders gave each grade (the trail_grade_counts view, no account ids).

drop policy if exists "anyone reads grades" on public.trail_grades;
drop policy if exists "riders read own grades" on public.trail_grades;
create policy "riders read own grades" on public.trail_grades for select to authenticated
  using (auth.uid() = user_id);

-- The counts view reads all grades for the totals (it runs as the database owner, so it isn't limited to one rider's
-- own rows). It only ever gives trail, grade and how many riders: never who.
create or replace view public.trail_grade_counts as
  select osm_type, osm_id, grade, count(*)::int as riders
  from public.trail_grades
  where public.tf_flags('grade', osm_id) < 3
  group by osm_type, osm_id, grade;
alter view public.trail_grade_counts set (security_invoker = false);
revoke all on public.trail_grade_counts from anon, authenticated;
grant select on public.trail_grade_counts to anon, authenticated;

-- Check (shows "ok" when done): a signed-out visitor sees no single grades, only the totals.
select case when exists (select 1 from pg_policies where tablename = 'trail_grades' and policyname = 'anyone reads grades')
  then 'not done' else 'ok' end as grades_private;
