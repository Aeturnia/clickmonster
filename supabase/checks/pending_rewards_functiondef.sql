-- The installed definition of save_hero_with_rewards() (#102; review of PR #107, NB-03).
-- READ-ONLY: it changes nothing. Run it after the migration, in production and on a local stack
-- reset from the same migration (npx supabase db reset), and compare: the md5 and the length must
-- match the values recorded in docs/pending-rewards-report.md, section 3. If they differ, compare
-- the "definition" column line by line before going on.
select md5(d) as md5, length(d) as length, d as definition
from (select pg_get_functiondef(to_regprocedure('public.save_hero_with_rewards(uuid,integer,jsonb,text,integer,text,integer,integer,bigint[])')) as d) t;
