-- Report and hide what riders post (go-public checklist item 3, Apple App Review rule 1.2, alex 2026-11-02).
-- Trail reports, rider photos and rider grades get ⚑ Report (signed in). 3 open reports on a post hide it for everyone
-- but the rider who posted it. alex (tf_admins, see usage.sql) sees every reported post on usage.html and removes it or
-- keeps it (dismiss the reports). "Hide this rider" is kept on the phone (moderation.js), nothing here.
-- Rider-added trails keep their own reports (rider-trails.sql).
-- Run once in the Supabase SQL editor, after trail-reports.sql, trail-photos.sql, trail-grades.sql and usage.sql.

create table if not exists public.content_flags (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('report', 'photo', 'grade')),
  -- report / photo: the post's id. grade: the trail (osm_type + osm_id), whose rider grades are reported as a whole.
  target_id bigint not null,
  osm_type text check (osm_type in ('way', 'relation')),
  reason text not null check (reason in ('rude', 'spam', 'wrong', 'unsafe', 'private', 'other')),
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now(),
  unique (user_id, kind, target_id)
);
create index if not exists content_flags_target on public.content_flags (kind, target_id);

alter table public.content_flags enable row level security;

drop policy if exists "riders flag" on public.content_flags;
create policy "riders flag" on public.content_flags for insert to authenticated
  with check (auth.uid() = user_id and created_at > now() - interval '5 minutes');
drop policy if exists "riders see own flags" on public.content_flags;
create policy "riders see own flags" on public.content_flags for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "riders take back own flags" on public.content_flags;
create policy "riders take back own flags" on public.content_flags for delete to authenticated
  using (auth.uid() = user_id);

-- How many riders reported a post (readable by the policies below without showing who reported it).
create or replace function public.tf_flags(k text, t bigint) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from content_flags where kind = k and target_id = t;
$$;
revoke all on function public.tf_flags(text, bigint) from public;
grant execute on function public.tf_flags(text, bigint) to anon, authenticated;

-- 3 reports hide a post for everyone but its rider (and alex, who sees it on usage.html).
drop policy if exists "anyone reads reports" on public.trail_reports;
create policy "anyone reads reports" on public.trail_reports for select to anon, authenticated
  using (public.tf_flags('report', id) < 3 or user_id = auth.uid());

drop policy if exists "anyone sees trail photos" on public.trail_photos;
create policy "anyone sees trail photos" on public.trail_photos for select to anon, authenticated
  using (public.tf_flags('photo', id) < 3 or user_id = auth.uid());

-- Grades: a trail whose rider grades got 3 reports drops out of the counts until alex keeps or clears them.
create or replace view public.trail_grade_counts with (security_invoker = true) as
  select osm_type, osm_id, grade, count(*)::int as riders
  from public.trail_grades
  where public.tf_flags('grade', osm_id) < 3
  group by osm_type, osm_id, grade;
grant select on public.trail_grade_counts to anon, authenticated;

-- ---------- alex only (usage.html, "Reported posts") ----------
create or replace function public.tf_flag_list()
returns table (kind text, target_id bigint, osm_type text, flags int, reasons text, notes text, last_at timestamptz,
  trail_name text, body text, path text, poster uuid, posted_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  return query
  with f as (
    select c.kind, c.target_id, max(c.osm_type) as osm_type, count(*)::int as flags,
      string_agg(distinct c.reason, ', ') as reasons,
      string_agg(c.note, ' | ') filter (where c.note is not null and c.note <> '') as notes, max(c.created_at) as last_at
    from content_flags c group by c.kind, c.target_id)
  select f.kind, f.target_id, f.osm_type, f.flags, f.reasons, f.notes, f.last_at,
    coalesce(r.trail_name, p.trail_name, (select g.trail_name from trail_grades g where g.osm_id = f.target_id limit 1)),
    case when f.kind = 'report' then r.condition || coalesce(': ' || r.note, '')
         when f.kind = 'photo' then p.caption
         else (select string_agg(x.grade || ' x' || x.n, ', ') from (select g.grade, count(*) as n from trail_grades g
                where g.osm_id = f.target_id group by g.grade) x) end,
    p.path, coalesce(r.user_id, p.user_id), coalesce(r.created_at, p.created_at)
  from f
  left join trail_reports r on f.kind = 'report' and r.id = f.target_id
  left join trail_photos p on f.kind = 'photo' and p.id = f.target_id
  order by f.flags desc, f.last_at desc;
end $$;

-- remove = true: delete the post (a report, a photo's row, or every rider grade on that trail); false: keep it.
-- Either way the reports on it are cleared. A removed photo's file is deleted by usage.html (storage API).
create or replace function public.tf_flag_done(k text, t bigint, remove boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not tf_is_admin() then raise exception 'not allowed'; end if;
  if remove then
    if k = 'report' then delete from trail_reports where id = t;
    elsif k = 'photo' then delete from trail_photos where id = t;
    elsif k = 'grade' then delete from trail_grades where osm_id = t;
    end if;
  end if;
  delete from content_flags where kind = k and target_id = t;
end $$;

revoke all on function public.tf_flag_list() from public;
revoke all on function public.tf_flag_done(text, bigint, boolean) from public;
grant execute on function public.tf_flag_list() to authenticated;
grant execute on function public.tf_flag_done(text, bigint, boolean) to authenticated;

-- alex removes a reported photo's file too (usage.html), so the picture is gone from the public bucket.
drop policy if exists "alex removes reported photo files" on storage.objects;
create policy "alex removes reported photo files" on storage.objects for delete to authenticated
  using (bucket_id = 'trail-photos' and public.tf_is_admin());
