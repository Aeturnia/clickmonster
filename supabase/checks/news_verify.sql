-- After applying supabase/migrations/20261115090000_news.sql (landing L-3,
-- docs/landing-l3-report.md, section 4). READ-ONLY: it changes nothing.
-- Paste into the Supabase SQL editor; every row's "ok" must be true. Record the result.
-- The last row (the migration's history entry) is true only once it is recorded: by the CLI if
-- the migration went through `db push`, or by `supabase migration repair` after a manual apply.
with
cols(c) as (values ('body'), ('id'), ('kind'), ('maintenance_ends_at'), ('maintenance_starts_at'), ('published_at'), ('revised_at'), ('slug'), ('summary'), ('title')),
want as (select string_agg(c, ',' order by c) as v from cols),
granted(role, v) as (
  select r, (select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges
             where table_schema = 'public' and table_name = 'news' and grantee = r and privilege_type = 'SELECT')
  from (values ('anon'), ('authenticated')) as x(r)
),
checks(n, item, expected, actual) as (values
  (1, 'public.news exists', 'true', (to_regclass('public.news') is not null)::text),
  (2, 'row-level security is on', 'true', coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.news')), 'no table')),
  (3, 'anon can select exactly the article columns', (select v from want), coalesce((select v from granted where role = 'anon'), 'none')),
  (4, 'authenticated can select exactly the article columns', (select v from want), coalesce((select v from granted where role = 'authenticated'), 'none')),
  (5, 'anon and authenticated have no table-wide select or any write', 'none', coalesce((
     select string_agg(r || ':' || p, ', ' order by r, p)
     from (values ('anon'), ('authenticated')) as x(r), (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as y(p)
     where to_regclass('public.news') is not null and has_table_privilege(r, 'public.news', p)), 'none')),
  (6, 'the read policy: select, for anon and authenticated, published and past', 'SELECT {anon,authenticated} status = published and published_at <= now()',
     coalesce((select cmd || ' ' || roles::text || ' ' ||
       case when qual ~ 'status = ''published''' and qual ~ 'published_at <= now\(\)' then 'status = published and published_at <= now()' else qual end
       from pg_policies where schemaname = 'public' and tablename = 'news' and policyname = 'Anyone can read published news'), 'no policy')),
  (7, 'only that one policy', '1', (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'news')),
  (8, 'the news_guard trigger (before update or delete)', 'true', exists (
     select 1 from pg_trigger where tgrelid = to_regclass('public.news') and tgname = 'news_guard' and not tgisinternal)::text),
  (9, 'check constraints', 'news_body_length,news_kind,news_published_has_date,news_revised_after_published,news_slug_format,news_status,news_summary_length,news_title_length,news_window_only_maintenance,news_window_order',
     coalesce((select string_agg(conname, ',' order by conname) from pg_constraint where conrelid = to_regclass('public.news') and contype = 'c'), 'none')),
  (10, 'the address is unique', 'true', exists (
     select 1 from pg_constraint where conrelid = to_regclass('public.news') and contype = 'u')::text),
  (11, 'the public list index', 'true', (to_regclass('public.news_published_idx') is not null)::text),
  (12, 'news_guard() is not executable by anon or authenticated', 'false,false', coalesce((
     select has_function_privilege('anon', p.oid, 'EXECUTE')::text || ',' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
     from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'news_guard'), 'no function')),
  (13, 'migration 20261115090000 recorded in the history', 'true', case
     when to_regclass('supabase_migrations.schema_migrations') is null then 'no history table'
     else coalesce((xpath('/row/v/text()', query_to_xml(
       'select (count(*) > 0)::text as v from supabase_migrations.schema_migrations where version = ''20261115090000''', false, true, '')))[1]::text, 'false')
     end)
)
select n, item, expected, actual, expected = actual as ok from checks order by n;
