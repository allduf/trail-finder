-- Trail Finder usage page, costs and limits: run once in the Supabase SQL Editor (paste, then Run), after usage.sql,
-- usage-more.sql, photo-ai-limits.sql and ask-limits.sql (all already run).
--   * tf_use_report reads events in a fixed order (time, then id), so usage.html can read them 1,000 at a time
--     (Supabase hands back at most 1,000 rows per call; before this the newest events past 1,000 were cut off).
--   * tf_use_limits gives usage.html the "Costs and limits" card: photo find and Ask use per day against their daily
--     limits, how full the free database is, and how many usage events are kept. It also clears usage events older
--     than a year (the page never shows more than 365 days), so the table can't fill the free database.

create or replace function public.tf_use_report(days int default 30)
returns table (device text, label text, os text, screen text, session text, at timestamptz, page text, kind text, what text, ms int)
language plpgsql security definer set search_path = public stable as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  return query
    select e.device, d.label, d.os, d.screen, e.session, e.at, e.page, e.kind, e.what, e.ms
    from tf_use_events e join tf_use_devices d using (device)
    where e.at > now() - make_interval(days => least(greatest(days, 1), 365))
    order by e.at, e.id;
end $$;

create or replace function public.tf_use_limits() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  delete from tf_use_events where at < now() - interval '366 days';
  select jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'events', (select count(*) from tf_use_events),
    'events_bytes', pg_total_relation_size('public.tf_use_events'),
    'photo', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'kind', kind, 'n', n) order by day desc, kind)
                       from photo_ai_use where day > current_date - 7), '[]'::jsonb)
  ) into r;
  return r;
end $$;

revoke all on function public.tf_use_report(int) from public;
revoke all on function public.tf_use_limits() from public;
grant execute on function public.tf_use_report(int) to authenticated;
grant execute on function public.tf_use_limits() to authenticated;
