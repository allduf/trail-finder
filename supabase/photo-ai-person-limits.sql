-- Trail Finder find-by-photo daily limits per person: run once in the Supabase SQL Editor (paste, then Run).
-- On top of the app-wide limits (photo-ai-limits.sql): the find-by-photo function (functions/which-trail) counts each
-- person's uses here first, so one keen rider can't use up everyone's day:
--   vision  = Google reverse image searches: 10 a day per person by default
--   ai      = Gemini looks at a picture: 20 a day per person by default
--   compare = Gemini online checks: 20 a day per person by default
-- Change a limit with a function secret (VISION_PER_PERSON, AI_PER_PERSON, COMPARE_PER_PERSON). Days are UTC days.
-- A person is a signed-in account ("u:" + its id), or else a connection ("ip:" + a hash of its address: the address
-- itself is never stored). Rows older than a week are cleared as new ones come in.
-- Nobody can read or change the counts through the site: only the function (with Supabase's service key) can.

create table if not exists public.photo_ai_person_use (
  day date not null,
  who text not null,
  kind text not null check (kind in ('vision', 'ai', 'compare')),
  n integer not null default 0,
  primary key (day, who, kind)
);
alter table public.photo_ai_person_use enable row level security;   -- no policies: closed to the site
revoke all on public.photo_ai_person_use from anon, authenticated;

-- Takes one use of a kind for a person; false (and nothing counted) when their limit for today is used up.
create or replace function public.photo_ai_take_person(p_who text, p_kind text, p_cap integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  delete from photo_ai_person_use where day < current_date - 7;
  insert into photo_ai_person_use as u (day, who, kind, n) values (current_date, p_who, p_kind, 1)
    on conflict (day, who, kind) do update set n = u.n + 1
    returning n into v;
  if v > p_cap then
    update photo_ai_person_use set n = n - 1 where day = current_date and who = p_who and kind = p_kind;
    return false;
  end if;
  return true;
end $$;
revoke execute on function public.photo_ai_take_person(text, text, integer) from public, anon, authenticated;
grant execute on function public.photo_ai_take_person(text, text, integer) to service_role;

-- Who used the most today (handy in the SQL Editor):
--   select who, kind, n from photo_ai_person_use where day = current_date order by n desc;
