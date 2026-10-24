-- Trail Finder find-by-photo daily limits: run once in the Supabase SQL Editor (paste, then Run).
-- The find-by-photo function (functions/which-trail) counts each use here, for the whole app (not per phone), and
-- stops for the day at its limits, so a busy day (or someone hammering it) can't run up a Google bill:
--   vision  = Google Cloud Vision reverse image searches (1,000 a month free, then billed): 30 a day by default
--   ai      = Gemini looks at a picture: 200 a day by default
--   compare = Gemini online checks (Google search + photos): 100 a day by default
-- Change a limit with a function secret (VISION_PER_DAY, AI_PER_DAY, COMPARE_PER_DAY). Days are UTC days.
-- Nobody can read or change the counts through the site: only the function (with Supabase's service key) can.

create table if not exists public.photo_ai_use (
  day date not null,
  kind text not null check (kind in ('vision', 'ai', 'compare')),
  n integer not null default 0,
  primary key (day, kind)
);
alter table public.photo_ai_use enable row level security;   -- no policies: closed to the site
revoke all on public.photo_ai_use from anon, authenticated;

-- Takes one use of a kind; false (and nothing counted) when today's limit is used up.
create or replace function public.photo_ai_take(p_kind text, p_cap integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into photo_ai_use as u (day, kind, n) values (current_date, p_kind, 1)
    on conflict (day, kind) do update set n = u.n + 1
    returning n into v;
  if v > p_cap then
    update photo_ai_use set n = n - 1 where day = current_date and kind = p_kind;
    return false;
  end if;
  return true;
end $$;
revoke execute on function public.photo_ai_take(text, integer) from public, anon, authenticated;
grant execute on function public.photo_ai_take(text, integer) to service_role;

-- How much was used, newest day first (handy in the SQL Editor): select * from photo_ai_use order by day desc, kind;
