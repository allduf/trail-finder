-- Trail Finder: lets riders report a trail as "🚧 Closed" (2026-10-24). Run once in the Supabase SQL Editor (paste, then Run).
-- It only widens the list of conditions a report can have; nothing else changes.
alter table public.trail_reports drop constraint if exists trail_reports_condition_check;
alter table public.trail_reports add constraint trail_reports_condition_check
  check (condition in ('dry', 'tacky', 'muddy', 'trees_down', 'snow', 'closed'));
