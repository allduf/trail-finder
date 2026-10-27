-- Trail Finder "Ask in plain words" daily limits: run once in the Supabase SQL Editor (paste, then Run), after
-- photo-ai-limits.sql and photo-ai-person-limits.sql (already run). It lets the same counters count questions too
-- (kind 'ask'), so the photo function (functions/which-trail, deployed as "smooth-worker") stops for the day at:
--   ask = questions in plain words: 300 a day for the whole app, 30 a day per person by default
-- Change a limit with a function secret (ASK_PER_DAY, ASK_PER_PERSON). Days are UTC days. Until this is run, each
-- running copy of the function counts questions on its own (the limits still hold, per copy).

alter table public.photo_ai_use drop constraint if exists photo_ai_use_kind_check;
alter table public.photo_ai_use add constraint photo_ai_use_kind_check check (kind in ('vision', 'ai', 'compare', 'ask'));
alter table public.photo_ai_person_use drop constraint if exists photo_ai_person_use_kind_check;
alter table public.photo_ai_person_use add constraint photo_ai_person_use_kind_check check (kind in ('vision', 'ai', 'compare', 'ask'));

-- How many questions were asked, newest day first: select * from photo_ai_use where kind = 'ask' order by day desc;
