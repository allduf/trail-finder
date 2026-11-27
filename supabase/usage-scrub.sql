-- Usage never keeps anything personal (2026-11-27). Run once in Supabase: SQL Editor, New query, paste all, Run.
-- Safe to run again.
--
-- Why: tapping the Account button in More stored its tooltip, the signed-in person's email, as the tap's label
-- (tf_use_events.what, since 2026-11-05). usage.js no longer sends it (it sends "Account"), and it also turns any
-- email, phone number or map point into a plain word. This file does the same on the server:
--   1. tf_use_scrub(text): the same rule as usage.js.
--   2. A trigger that runs it on every new usage row, for copies of the old script still cached on phones.
--   3. Fixes the rows already stored: it overwrites the label, it deletes no row (visit counts stay the same).
-- At the end it shows how many stored rows still hold an email (should be 0).

-- 1. The rule. Emails, then (with everything = true) map points (two numbers with decimals, or one with 4+
--    decimals) and phone numbers (9 to 15 digits with spaces, brackets, dots or dashes between). Error messages keep
--    their numbers (times, sizes, versions): only emails go.
drop function if exists public.tf_use_scrub(text);
create or replace function public.tf_use_scrub(t text, everything boolean default true) returns text
language sql immutable set search_path = public as $$
  select case when not everything then e else
    regexp_replace(regexp_replace(regexp_replace(e,
      '-?\d{1,3}\.\d{3,}\s*[,; ]\s*-?\d{1,3}\.\d{3,}', '[point]', 'g'),
      '-?\y\d{1,3}\.\d{4,}\y', '[point]', 'g'),
      '\+?\d([\s().-]*\d){8,14}', '[phone]', 'g') end
  from (select regexp_replace(left(t, 400), '[[:alnum:]_.%+#-]+@[[:alnum:]_#-]+(\.[[:alnum:]_#-]+)+', '[email]', 'g') as e) x;
$$;

-- 2. Every new row. A tap whose label starts with an email (even one cut short) is the Account button. A tap in a
--    place that shows what people typed (a cabin or bike trip's group, costs, meals, notes...; the trip lists) keeps
--    only the place, as usage.js now sends it ("item (in #tpCost)").
create or replace function public.tf_use_scrub_row() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.what is not null then
    if new.kind = 'tap' then
      new.what := regexp_replace(new.what, '^\S*@\S*', 'Account');
      if new.what ~ ' \(in #(tpGroup|tpIam|tpCost|tpMeals|tpJour|tpPack|tpPlan|tpCatch|tpPhotos|tpBook|tpCabin|tpBikes|tpDays|tpStops|skTrip|mtTrips|mtTripCard)\)$'
         and new.what !~ '^(#|[[:alnum:]_]+=|list:|item )' then
        new.what := 'item' || substring(new.what from '( \(in #[[:alnum:]_-]+\))$');
      end if;
    end if;
    new.what := left(tf_use_scrub(new.what, new.kind <> 'error'), 120);
  end if;
  return new;
end $$;

drop trigger if exists tf_use_scrub on public.tf_use_events;
create trigger tf_use_scrub before insert or update of what on public.tf_use_events
  for each row execute function public.tf_use_scrub_row();

-- 3. Rows already stored: each is saved again as it is, and the trigger above cleans its label on the way.
update public.tf_use_events set what = what
where what ~ '@'
   or (kind <> 'error' and (what ~ '\d([\s().-]*\d){8}' or what ~ '\d\.\d{3,}'))
   or (kind = 'tap' and what ~ ' \(in #(tp|skTrip|mtTrip)');

-- Check: both numbers should be 0.
select
  (select count(*) from public.tf_use_events where what ~ '[[:alnum:]_.%+#-]+@[[:alnum:]_#-]+\.[[:alnum:]_#.-]+'
     or (kind = 'tap' and what ~ '@')) as rows_with_email,
  (select count(*) from public.tf_use_events where kind = 'tap'
     and what ~ ' \(in #(tpGroup|tpIam|tpCost|tpMeals|tpJour|tpPack|tpPlan|tpCatch|tpPhotos|tpBook|tpCabin|tpBikes|tpDays|tpStops|skTrip|mtTrips|mtTripCard)\)$'
     and what !~ '^(#|[[:alnum:]_]+=|list:|item )') as trip_labels_left;
