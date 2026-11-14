-- Before applying supabase/migrations/20261115090000_news.sql to production (landing L-3,
-- docs/landing-l3-report.md, section 4). READ-ONLY: it changes nothing.
-- Paste into the Supabase SQL editor and record the whole result in the report.
--   - Rows 2 to 4 must be false or none: anything else means news objects already exist, and the
--     migration must not be applied until that is understood.
--   - Rows 5 and 6 show the migration history, row 7 the earlier migrations' tables. Together they
--     decide how the migration is applied (the report's decision table). An older migration's
--     history entry is never added just because its file exists.
with expected_tables(name) as (
  values ('characters'), ('quests'), ('events'), ('staff'), ('sanctions'), ('admin_log'), ('world_config'), ('hunts'),
         ('hunt_hits'), ('pending_rewards'), ('ledger'), ('zones'), ('chat_messages'), ('chat_ignores'), ('chat_reports')
)
select n, item, value from (values
  (1, 'Postgres version', current_setting('server_version')),
  (2, 'public.news exists (expected: false)', (to_regclass('public.news') is not null)::text),
  (3, 'public.news_guard() exists (expected: false)', exists (
     select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'news_guard')::text),
  (4, 'policies on public.news (expected: none)', coalesce((select string_agg(policyname, ', ') from pg_policies where schemaname = 'public' and tablename = 'news'), 'none')),
  (5, 'migration history table exists', (to_regclass('supabase_migrations.schema_migrations') is not null)::text),
  (6, 'recorded migration versions', case
     when to_regclass('supabase_migrations.schema_migrations') is null then 'no history table'
     else coalesce((xpath('/row/v/text()', query_to_xml(
       'select string_agg(version, '', '' order by version) as v from supabase_migrations.schema_migrations', false, true, '')))[1]::text, 'none')
     end),
  (7, 'earlier migrations'' tables missing (expected: none)', coalesce(
     (select string_agg(name, ', ') from expected_tables where to_regclass('public.' || name) is null), 'none'))
) as t(n, item, value)
order by n;
