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

-- 1. The rule. Emails, then map points (two numbers with decimals, or one with 4+ decimals), then phone numbers
--    (9 to 15 digits with spaces, brackets, dots or dashes between). In usage labels digits are already "#".
create or replace function public.tf_use_scrub(t text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(t,
    '[[:alnum:]_.%+#-]+@[[:alnum:]_#-]+(\.[[:alnum:]_#-]+)+', '[email]', 'g'),
    '-?\d{1,3}\.\d{3,}\s*[,; ]\s*-?\d{1,3}\.\d{3,}', '[point]', 'g'),
    '-?\y\d{1,3}\.\d{4,}\y', '[point]', 'g'),
    '\+?\d([\s().-]*\d){8,14}', '[phone]', 'g');
$$;

-- 2. Every new row. A tap whose label was an email is the Account button.
create or replace function public.tf_use_scrub_row() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.what is not null then
    if new.kind = 'tap' then
      new.what := regexp_replace(new.what, '^[[:alnum:]_.%+#-]+@[[:alnum:]_#-]+(\.[[:alnum:]_#-]+)+', 'Account');
    end if;
    new.what := left(tf_use_scrub(new.what), 120);
  end if;
  return new;
end $$;

drop trigger if exists tf_use_scrub on public.tf_use_events;
create trigger tf_use_scrub before insert or update of what on public.tf_use_events
  for each row execute function public.tf_use_scrub_row();

-- 3. Rows already stored (the trigger above cleans each label as it is rewritten).
--    a. Every label: emails, phone numbers and map points.
update public.tf_use_events set what = what
where what ~ '@' or what ~ '\d[\s().-]*\d[\s().-]*\d[\s().-]*\d[\s().-]*\d[\s().-]*\d[\s().-]*\d[\s().-]*\d[\s().-]*\d'
   or what ~ '\d\.\d{3,}';
--    b. Taps in places that show what people typed (a cabin or bike trip's group, costs, meals and notes; the trip
--       lists): only the place is kept, as usage.js now sends ("item (in #tpCost)").
update public.tf_use_events
set what = 'item' || substring(what from '( \(in #[[:alnum:]_-]+\))$')
where kind = 'tap'
  and what ~ ' \(in #(tp[[:alnum:]_-]*|skTrip|mtTrips|mtTripCard)\)$'
  and what !~ '^(#|[[:alnum:]_]+=|list:|item )';

-- Check: both numbers should be 0.
select
  (select count(*) from public.tf_use_events where what ~ '[[:alnum:]_.%+#-]+@[[:alnum:]_#-]+\.[[:alnum:]_#.-]+') as rows_with_email,
  (select count(*) from public.tf_use_events where kind = 'tap'
     and what ~ ' \(in #(tp[[:alnum:]_-]*|skTrip|mtTrips|mtTripCard)\)$'
     and what !~ '^(#|[[:alnum:]_]+=|list:|item )') as trip_labels_left;
